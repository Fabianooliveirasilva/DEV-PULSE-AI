import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

// Destinations a monitor or webhook must never reach: loopback, private ranges, link-local
// (incl. cloud metadata 169.254.169.254), CGNAT, multicast, reserved and documentation ranges.
const blockList = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockList.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can map to internal IPv4
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockList.addSubnet(net, prefix, 'ipv6');
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

export class BlockedDestinationError extends Error {
  readonly code = 'BLOCKED_DESTINATION';
  constructor(message: string) {
    super(message);
    this.name = 'BlockedDestinationError';
  }
}

export interface SsrfPolicy {
  /** Hostnames or IPs explicitly allowed even when private. Intended for dev/test only. */
  allowlist?: readonly string[];
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockList.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return blockList.check(mapped[1], 'ipv4');
    return blockList.check(address, 'ipv6');
  }
  return true; // not an IP at all: refuse
}

function normaliseHost(hostname: string) {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function isAllowlisted(host: string, policy: SsrfPolicy) {
  return (policy.allowlist ?? []).some((entry) => normaliseHost(entry) === host);
}

/** Static checks that need no network: scheme, credentials, blocked names and literal IPs. */
export function assertUrlShape(rawUrl: string, policy: SsrfPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedDestinationError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedDestinationError('Only http and https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new BlockedDestinationError('URLs with embedded credentials are not allowed');
  }
  const host = normaliseHost(url.hostname);
  if (isAllowlisted(host, policy)) return url;
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedDestinationError(`Destination host "${host}" is not allowed`);
  }
  if (isIP(host) && isBlockedAddress(host)) {
    throw new BlockedDestinationError('Destination address is in a private or reserved range');
  }
  return url;
}

type LookupFn = (
  hostname: string,
  options: { all: true },
  cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/** Resolves a hostname and rejects if ANY resolved address is blocked. */
export async function resolveAndValidate(
  hostname: string,
  policy: SsrfPolicy = {},
  lookup: LookupFn = dnsLookup as unknown as LookupFn,
): Promise<LookupAddress[]> {
  const host = normaliseHost(hostname);
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) =>
    lookup(host, { all: true }, (err, result) => (err ? reject(err) : resolve(result))),
  );
  if (addresses.length === 0) throw new BlockedDestinationError(`No addresses for ${host}`);
  if (isAllowlisted(host, policy)) return addresses;
  const blocked = addresses.find((a) => isBlockedAddress(a.address));
  if (blocked) {
    throw new BlockedDestinationError(`${host} resolves to a private or reserved address`);
  }
  return addresses;
}

/** Full pre-flight validation used when a monitor/webhook URL is saved. */
export async function validateDestination(rawUrl: string, policy: SsrfPolicy = {}) {
  const url = assertUrlShape(rawUrl, policy);
  await resolveAndValidate(url.hostname, policy);
  return url;
}

/**
 * A `lookup` implementation for http.request that re-validates every resolution at
 * connection time. This closes the DNS-rebinding window between validation and connect.
 */
export function createGuardedLookup(policy: SsrfPolicy = {}) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    const wantsAll = typeof options === 'object' && options?.all === true;
    resolveAndValidate(hostname, policy).then(
      (addresses) => {
        if (wantsAll) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, wantsAll ? [] : '', undefined),
    );
  };
}
