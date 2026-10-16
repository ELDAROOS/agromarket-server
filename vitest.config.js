import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Читаем .env.test и ПЕРЕКРЫВАЕМ им то, что могло быть загружено раньше.
// В CI файла нет — там переменные задаёт сам workflow (часть 6).
const { parsed } = dotenv.config({ path: '.env.test', override: true, quiet: true });

export default defineConfig({
  test: {
    env: parsed,                           // переменные для файлов с тестами
    globalSetup: './tests/globalSetup.js', // один раз перед всеми тестами
    setupFiles: ['./tests/setup.js'],      // перед каждым файлом тестов
    fileParallelism: false,                // файлы по очереди: база одна на всех
    coverage: {
      include: ['app.js', 'routes/**', 'middleware/**'],
    },
  },
});
