import {expect, test} from "../helpers/fixture";
import {utilsPubli} from "../helpers/utilsPubli";

test('Should search for phone number and list all attached ads.', async ({ page, context }) => {
  await utilsPubli.open(context, page);
  const firstAd =  await utilsPubli.findFirstAdWithPhone(page);
  const phone = await (await firstAd.$('[data-wwid="phone-number"]')).innerText();

  await page.locator('[data-wwid="menu-button"]').click();
  await page.locator('[data-wwid="phone-search-button"]').click();
  await expect(page.locator('[data-wwid="ads-modal"]')).toBeVisible();

  await page.locator('[data-wwid="phone-input"]').type(phone);
  await page.waitForTimeout(2000);

  expect((await page.$$('[data-wwid="ads-modal"] [data-articleid]')).length).toBeGreaterThanOrEqual(1);
  expect((await page.$$('[data-wwid="ads-modal"] [data-articleid] [data-wwid="control-panel"]')).length).toBeGreaterThanOrEqual(1);
})

test('Should run the complete phone search for a manually entered number.', async ({ page, context }, testInfo) => {
  testInfo.setTimeout(60000 * 3);

  await utilsPubli.open(context, page, {loadStorage: false});
  const firstAd = await utilsPubli.findFirstAdWithPhone(page);
  const phone = await (await firstAd.$('[data-wwid="phone-number"]')).innerText();

  await page.locator('[data-wwid="menu-button"]').click();
  await page.locator('[data-wwid="phone-search-button"]').click();
  await page.locator('[data-wwid="phone-input"]').fill(phone);
  await expect(page.locator('[data-wwid="full-phone-search-button"]')).toBeEnabled();

  const fullSearchButton = await page.waitForSelector('[data-wwid="full-phone-search-button"]');
  await utilsPubli.resolveGooglePage(fullSearchButton, context, page);

  await expect(page.locator('[data-wwid="full-phone-search-results"]')).toBeVisible();
  await expect(page.locator('[data-wwid="full-phone-search-results"]')).toContainText('Rezultate căutare completă');
});
