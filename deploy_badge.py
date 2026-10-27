# -*- coding: utf-8 -*-
"""部署后端：entry.js / badgePdf.js / rosterPdf.js / helpers.js → 10.128.1.45，重启服务"""
import os
import paramiko

os.chdir(os.path.dirname(os.path.abspath(__file__)))

HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
BASE = '/home/single/sport-compete/server'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)

def run(cmd):
    _, out, err = cli.exec_command(cmd, timeout=60)
    o = out.read().decode('utf-8', 'replace').strip()
    e = err.read().decode('utf-8', 'replace').strip()
    return o, e

# 1. 上传文件
sftp = cli.open_sftp()
files = [
    ('server/routes/entry.js', f'{BASE}/routes/entry.js'),
    ('server/services/badgePdf.js', f'{BASE}/services/badgePdf.js'),
    ('server/services/rosterPdf.js', f'{BASE}/services/rosterPdf.js'),
    ('server/utils/helpers.js', f'{BASE}/utils/helpers.js'),
]
for local, remote in files:
    sftp.put(local, remote)
    print('uploaded:', remote)

# 2. 字体确认（没有就传）
o, _ = run(f'ls {BASE}/fonts/ 2>/dev/null')
print('server fonts:', o or '(none)')
if 'deng.ttf' not in o:
    run(f'mkdir -p {BASE}/fonts')
    sftp.put('server/fonts/deng.ttf', f'{BASE}/fonts/deng.ttf')
    sftp.put('server/fonts/deng_bold.ttf', f'{BASE}/fonts/deng_bold.ttf')
    print('fonts uploaded')

# 3. pdfkit 确认
o, e = run(f'cd {BASE} && node -e "require(\'pdfkit\'); console.log(\'pdfkit ok\')"')
print('pdfkit check:', o or e)
sftp.close()

# 4. 语法检查 + 重启
o, e = run(f'node --check {BASE}/routes/entry.js && echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

cli.close()
print('DEPLOY DONE')
