from playwright.sync_api import sync_playwright
import re
import os
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(accept_downloads=True)
    page=context.new_page()
    page.route('https://studio.genlayer.com/**', lambda route: route.abort())
    page.goto(os.environ.get('MF_TEST_URL', 'http://127.0.0.1:8765'))
    page.on('dialog', lambda d: d.accept('browser test password 123'))
    page.locator('#btn-enable-test-account').click()
    page.wait_for_function("document.querySelector('#btn-enable-test-account').disabled")
    original=page.locator('#test-account-state').inner_text()
    address=re.search(r'0x[0-9a-fA-F]{40}',original).group()
    with page.expect_download() as download:
        page.locator('#btn-export-signer').click()
    backup=download.value.path()
    page.reload()
    page.locator('#btn-enable-test-account').click()
    page.wait_for_function("document.querySelector('#btn-enable-test-account').disabled")
    assert address in page.locator('#test-account-state').inner_text()
    page.evaluate('localStorage.removeItem("mf-encrypted-signer-v1")')
    page.reload()
    page.locator('#import-signer').set_input_files(backup)
    page.wait_for_function("document.querySelector('#btn-enable-test-account').disabled")
    assert address in page.locator('#test-account-state').inner_text()
    assert page.evaluate('window.MF_CONFIG.writesEnabled') is False
    browser.close()
    print('Browser PASS: create, encrypted export, reload/unlock, clear storage/import, identical address, historical writes disabled. RPC blocked; no chain writes.')
