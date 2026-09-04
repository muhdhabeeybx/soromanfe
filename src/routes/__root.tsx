import React, { useState, useEffect } from 'react'
import {
  createRootRoute,
  useRouter,
  useRouterState,
  Link,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { useAuthStore } from '#/modules/auth'
import { useLayoutStore } from '#/stores/layoutStore'
import Sidebar from '#/components/layout/Sidebar'
import Navbar from '#/components/layout/Navbar'
import { QueryProvider } from '#/components/QueryProvider'
import { ToastContainer } from '#/components/ui/toast'
import { ErrorBoundary } from '#/components/ErrorBoundary'
import { Button } from '#/components/ui/button'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Soroman Energy Operations Portal',
      },
    ],
    // General Sans is self-hosted from src/assets/fonts and declared in
    // styles.css — no CDN round-trip. Two static weights only, 400 and 600.
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  component: RootDocument,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
      <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
        <AlertTriangle className="size-8" />
      </div>
      <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">Page Not Found</h2>
      <p className="text-muted-foreground max-w-sm">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
      <Link to="/overview">
        <Button>
          <ArrowLeft className="size-4 mr-2" />
          Back to Overview
        </Button>
      </Link>
    </div>
  )
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const location = useRouterState({ select: (s) => s.location })

  // Instantly check if user session is already active or if accessing a public route 
  // to prevent showing a loading screen to already authenticated users.
  const [isReady, setIsReady] = useState(false)

  const isPublicRoute = location.pathname === '/login' || location.pathname === '/set-password'
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!isPublicRoute && !accessToken && !user) {
      router.navigate({ to: '/login' })
      return
    }

    setIsReady(true)
  }, [location.pathname, router, accessToken, user, isPublicRoute])

  if (!isReady && !isPublicRoute) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-background text-foreground transition-colors duration-300 ease-luxe">
        <div className="relative flex flex-col items-center">
          {/* Logo container with pulse & subtle ring */}
          <div className="relative flex items-center justify-center size-24 mb-4">
            {/* Spinning gradient ring */}
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />

            {/* Pulsing glow background */}
            <div className="absolute inset-2 rounded-full bg-primary/10 blur-md animate-pulse" />

            {/* Centered logo */}
            <img
              src="/logo.png"
              alt="Soroman"
              className="relative size-10 object-contain"
            />
          </div>

          {/* Brand/Loading text */}
          <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase animate-pulse">
            Soroman
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Securing session...
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

function RootDocument() {
  const { isCollapsed } = useLayoutStore()
  const location = useRouterState({ select: (s) => s.location })
  const isLoginRoute = location.pathname === '/login'

  const isPublicRoute = isLoginRoute || location.pathname === '/set-password'

  return (
    <QueryProvider>
      <ErrorBoundary>
      <AuthGuard>
        {isPublicRoute ? (
          <Outlet />
        ) : (
          // svh, never vh — mobile browser chrome would clip the shell.
          // The ground is bg-sidebar so the inset content card below can float
          // off it as its own rounded surface.
          <div className="flex min-h-svh bg-sidebar text-foreground">
            <Sidebar />

            <div
              className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-linear
 ${isCollapsed ? 'md:pl-12' : 'md:pl-64'}
 `}
            >
              {/* With shadows gone, the inset card needs the hairline to
                  separate it from the sidebar ground. */}
              <div className="flex min-h-svh min-w-0 flex-1 flex-col overflow-hidden bg-background md:m-2 md:ml-0 md:min-h-[calc(100svh-1rem)] md:rounded-xl md:border md:border-border">
                <Navbar />

                <main className="flex-1 overflow-y-auto p-4 md:p-6">
                  {/* max-w-6xl is the content column across the whole app. */}
                  <div className="mx-auto max-w-6xl animate-fade-in">
                    <Outlet />
                  </div>
                </main>
              </div>
            </div>
          </div>
        )}
      </AuthGuard>
      </ErrorBoundary>

      <ToastContainer />

      {import.meta.env.DEV && (
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
      )}
    </QueryProvider>
  )
}

