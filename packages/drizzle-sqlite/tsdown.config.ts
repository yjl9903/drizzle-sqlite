import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    migrator: 'src/migrator.ts'
  },
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist'
});
