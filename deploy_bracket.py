# -*- coding: utf-8 -*-
"""对阵图功能部署：schedule.js + publicMeet.js + 前端 dist"""
import os
import paramiko

BASE = os.path.dirname(os.path.abspath(__file__))
REMOTE = '/home/single/sport-compete'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=15)


def run(cmd, t=300):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


sftp = cli.open_sftp()
for f in ['schedule.js', 'publicMeet.js']:
    sftp.put(os.path.join(BASE, 'server', 'routes', f), f'{REMOTE}/server/routes/{f}')
    print('uploaded', f)
sftp.close()

print(run(f'cd {REMOTE}/server && node --check routes/schedule.js && node --check routes/publicMeet.js && echo SYNTAX_OK'))

# 前端 dist
run(f'rm -rf {REMOTE}/frontend/dist_new && mkdir -p {REMOTE}/frontend/dist_new')
sftp = cli.open_sftp()
count = 0


def up(local, remote):
    global count
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                sftp.mkdir(rp)
            except IOError:
                pass
            up(lp, rp)
        else:
            sftp.put(lp, rp)
            count += 1


up(os.path.join(BASE, 'frontend', 'dist'), REMOTE + '/frontend/dist_new')
sftp.close()
print('uploaded front:', count)
run(f'rm -rf {REMOTE}/frontend/dist && mv {REMOTE}/frontend/dist_new {REMOTE}/frontend/dist')

print('service:', run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 3 && systemctl is-active sport-compete-backend'))
print('local http:', run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/'))

cli.close()

# 腾讯云
print('\n===== 同步腾讯云 =====')
KEY = os.path.join(os.path.expanduser('~'), '.ssh', 'id_ed25519_tencent')
pub = paramiko.SSHClient()
pub.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pub.connect('150.158.39.237', 22, 'root', key_filename=KEY, timeout=20)


def prun(cmd, t=300):
    _, o, e = pub.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


PUB = '/var/www/sport-compete'
prun(f'rm -rf {PUB}_new && mkdir -p {PUB}_new')
psftp = pub.open_sftp()
c2 = 0


def up2(local, remote):
    global c2
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                psftp.mkdir(rp)
            except IOError:
                pass
            up2(lp, rp)
        else:
            psftp.put(lp, rp)
            c2 += 1


up2(os.path.join(BASE, 'frontend', 'dist'), PUB + '_new')
psftp.close()
print('uploaded tencent:', c2)
prun(f'rm -rf {PUB} && mv {PUB}_new {PUB}')
print(prun('nginx -t && systemctl reload nginx && echo nginx_reloaded'))
pub.close()
print('\n===== 完成 =====')
