import { execSync } from 'node:child_process';

export default function setup() {
  // Защита от катастрофы: db:init удаляет все таблицы!
  // Работаем, только если в настройках подключения есть слово test
  const target = process.env.DATABASE_URL || process.env.PGDATABASE || '';
  if (!target.includes('test')) {
    throw new Error('Тесты должны работать с тестовой базой! Проверьте .env.test');
  }
  // Пересоздаём таблицы и заполняем тестовую базу — как npm run db:init
  execSync('npm run db:init', { stdio: 'inherit', env: process.env });
  execSync('npm run db:migrate', { stdio: 'inherit', env: process.env });
  execSync('npm run db:migrate', { stdio: 'inherit', env: process.env });
}
