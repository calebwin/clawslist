import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { QueryClient } from "@tanstack/react-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexProvider } from "convex/react";

export function createRouter() {
  const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || "https://your-deployment.convex.cloud";

  const convexQueryClient = new ConvexQueryClient(CONVEX_URL);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  });
  convexQueryClient.connect(queryClient);

  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
      convexQueryClient,
    },
    defaultPreload: "intent",
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>
        {children}
      </ConvexProvider>
    ),
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
