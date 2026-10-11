// L5: the paste-a-value playground in the Column Reference.
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await page.click('button[title^="Column reference"]');
  await page.waitFor('document.querySelector("#identify-value")');
  const matches = `[...document.querySelectorAll('[data-role="matches"] li')].map(li => li.dataset.status + ':' + li.children[1]?.textContent)`;

  await page.fill('#identify-value', '4111 1111 1111 1111');
  check((await page.eval(matches)).join() === 'valid:Credit Card', `a test card number: ${await page.eval(matches)}`);
  await page.fill('#identify-value', '4111 1111 1111 1112');
  check((await page.eval(matches)).join() === 'invalid:Credit Card', `one digit off: ${await page.eval(matches)}`);
  await page.fill('#identify-value', '078051120');
  const both = await page.eval(matches);
  check(both.includes('valid:SSN') && both.includes('valid:Routing Number'), `a bare 9-digit number is both: ${both.slice(0, 3)}`);
  await page.fill('#identify-value', 'hello there');
  check((await page.eval(`document.querySelector('[data-role="matches"]').textContent`)).includes('Fits no identifier'), 'free text fits nothing');
  await page.fill('#identify-value', 'GB82 WEST 1234 5698 7654 32');
  await page.screenshot('identify.png');
  check((await page.eval(matches)).join() === 'valid:IBAN', 'a spaced IBAN is recognised');
};
