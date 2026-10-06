import 'reflect-metadata';
import 'dotenv/config';
import { createApplication } from './app.factory';
import { parseEnvironment } from './config/env';

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment(process.env);
  const app = await createApplication(environment);
  await app.listen(environment.PORT, environment.HOST);
}

void bootstrap().catch(() => {
  // Configuration validation never prints input values, which can contain secrets.
  console.error('API startup failed. Check environment configuration and local port availability.');
  process.exitCode = 1;
});
