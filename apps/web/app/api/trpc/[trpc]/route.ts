import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { AppError } from "@tahseel/core";
import { appRouter } from "@/server/routers";
import { createTrpcContext } from "@/server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTrpcContext(req.headers),
    responseMeta(opts) {
      const appErr = opts.errors.map((e) => e.cause).find((c) => c instanceof AppError) as AppError | undefined;
      if (appErr) {
        return { status: appErr.status };
      }
      return {};
    },
  });
export { handler as GET, handler as POST };
