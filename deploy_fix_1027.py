# -*- coding: utf-8 -*-
"""
2026-10-27 三项修复部署：
  1) 弹窗统一 attach="body"（名次表「手动设置名次」显示不全）
  2) 分组编排挂载时自动回显已保存分组
  3) 赛程编排拖拽改场地/时间（后端 PUT /schedule/match/:id 支持按日期+时间+场地自动建槽）
上传 server/routes/schedule.js + 前端 dist，重启服务。
"""
import os
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
REMOTE = '/home/single/sport-compete'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=300):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


# ---------- 一、后端 ----------
sftp = cli.open_sftp()
sftp.put(os.path.join(BASE_DIR, 'server', 'routes', 'schedule.js'), f'{REMOTE}/server/routes/schedule.js')
print('uploaded routes/schedule.js')
sftp.close()

o, e = run(f'cd {REMOTE}/server && node --check routes/schedule.js && echo SYNTAX_OK')
print(o or e)

# ---------- 二、前端 ----------
REMOTE_DIST = f'{REMOTE}/frontend/dist'
run(f'rm -rf {REMOTE_DIST}_new && mkdir -p {REMOTE_DIST}_new')
sftp = cli.open_sftp()
local_dist = os.path.join(BASE_DIR, 'frontend', 'dist')
count = 0


def upload_dir(local, remote):
    global count
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                sftp.mkdir(rp)
            except IOError:
                pass
            upload_dir(lp, rp)
        else:
            sftp.put(lp, rp)
            count += 1


upload_dir(local_dist, REMOTE_DIST + '_new')
sftp.close()
print('uploaded front files:', count)

o, e = run(f'rm -rf {REMOTE_DIST} && mv {REMOTE_DIST}_new {REMOTE_DIST} && ls {REMOTE_DIST}/assets | grep -iE "schedule|rank|grouping"')
print('新资源:', o or e)

o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 3 && systemctl is-active sport-compete-backend')
print('service:', o or e)

o, e = run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/ && echo " <- 内网首页状态码"')
print(o or e)

cli.close()

# ---------- 三、同步腾讯云 ----------
print('\n===== 同步到腾讯云 =====')
KEY = os.path.join(os.path.expanduser('~'), '.ssh', 'id_ed25519_tencent')
pub = paramiko.SSHClient()
pub.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pub.connect('150.158.39.237', 22, 'root', key_filename=KEY, timeout=20)


def prun(cmd, t=300):
    _, o, e = pub.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


PUB_REMOTE = '/var/www/sport-compete'
prun(f'rm -rf {PUB_REMOTE}_new && mkdir -p {PUB_REMOTE}_new')

psftp = pub.open_sftp()
count2 = 0


def upload_dir2(local, remote):
    global count2
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                psftp.mkdir(rp)
            except IOError:
                pass
            upload_dir2(lp, rp)
        else:
            psftp.put(lp, rp)
            count2 += 1


upload_dir2(local_dist, PUB_REMOTE + '_new')
psftp.close()
print('uploaded to tencent:', count2)

o, e = prun(f'rm -rf {PUB_REMOTE} && mv {PUB_REMOTE}_new {PUB_REMOTE} && ls {PUB_REMOTE}/assets | grep -iE "schedule|rank|grouping"')
print('新资源:', o or e)

o, e = prun('nginx -t && systemctl reload nginx && echo nginx_reloaded')
print(o or e)

pub.close()
print('\n===== 完成 =====')
