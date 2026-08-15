import { buildApp } from "./app.js";

const context = await buildApp();
try {
  const address = await context.app.listen({ host: context.config.host, port: context.config.port });
  context.app.log.info(`Family Message Box listening at ${address}`);
} catch (error) {
  context.app.log.error(error);
  process.exit(1);
}
