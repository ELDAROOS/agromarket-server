// URL содержит секрет: не выводим его или тело ответа в журнал.
const hook = process.env.RENDER_DEPLOY_HOOK_URL;
const sha = process.env.DEPLOY_SHA;
try {
  if (!hook || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Не заданы deploy hook или SHA');
  const url = new URL(hook);
  if (url.protocol !== 'https:' || url.hostname !== 'api.render.com') throw new Error('Ожидается HTTPS deploy hook Render');
  url.searchParams.set('ref', sha);
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Render: HTTP ${response.status}`);
  console.log(`Деплой коммита ${sha} запущен`);
} catch {
  console.error('Не удалось запустить деплой. Проверьте hook, SHA и события сервиса Render.');
  process.exitCode = 1;
}
