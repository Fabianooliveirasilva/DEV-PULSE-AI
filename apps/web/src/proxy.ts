import { type NextRequest, NextResponse } from 'next/server';

// Optimistic routing only: the API remains the authority on every request.
// A missing cookie sends users to /login; a present one keeps them out of auth pages.
const SESSION_COOKIES = ['__Host-dp_session', 'dp_session'];
const AUTH_PAGES = ['/login', '/register'];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  const { pathname, search } = request.nextUrl;

  if (AUTH_PAGES.includes(pathname)) {
    return hasSession
      ? NextResponse.redirect(new URL('/dashboard', request.url))
      : NextResponse.next();
  }
  if (!hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/login',
    '/register',
    '/dashboard/:path*',
    '/applications/:path*',
    '/monitoring/:path*',
    '/logs/:path*',
    '/ai/:path*',
    '/incidents/:path*',
    '/reliability/:path*',
    '/notifications/:path*',
    '/settings/:path*',
    '/profile/:path*',
  ],
};
