# -*- coding: utf-8 -*-
"""把构建产物里登录页快捷填充的 admin 密码改掉（源码已改，这里同步 dist 以便立即生效）"""
import io
import os
import re

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frontend', 'dist', 'assets')
target = None
for name in os.listdir(DIST):
    if name.startswith('Login-') and name.endswith('.js'):
        target = os.path.join(DIST, name)
        break

assert target, '没找到 Login-*.js'
s = io.open(target, encoding='utf-8').read()
print('文件:', os.path.basename(target))
print('admin123 出现次数:', s.count('admin123'))

# 只替换 DEMO 里那种「username:"admin",password:"xxx"」结构
pat = re.compile(r'(username:"admin",password:")[^"]*(")')
m = pat.search(s)
if not m:
    print('未匹配到 DEMO 结构，改为全量替换')
    s2 = s.replace('admin123', '体卫艺科')
else:
    s2 = pat.sub(r'\g<1>体卫艺科\g<2>', s)

io.open(target, 'w', encoding='utf-8', newline='').write(s2)
after = io.open(target, encoding='utf-8').read()
m2 = pat.search(after)
print('替换后:', m2.group(0) if m2 else '(未匹配)')
print('剩余 admin123 次数:', after.count('admin123'))
