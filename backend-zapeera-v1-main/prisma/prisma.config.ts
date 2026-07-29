import { defineConfig } from '@prisma/cli';

export default defineConfig({
  datasources: {
    db: {
      provider: 'sqlite',
      url: 'file:./dev.db',
    },
  },
});