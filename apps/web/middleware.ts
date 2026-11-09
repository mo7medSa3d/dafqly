import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip API routes, health probes, the public statement pages (/s/...) and static files.
  matcher: ["/((?!api|healthz|readyz|s/|_next|.*\\..*).*)"],
};
