# -*- coding: utf-8 -*-
"""
给所有 <t-dialog> / <t-drawer> 的起始标签补 attach="body"。

背景：TDesign 弹层默认内联渲染（不 teleport），一旦祖先元素带 transform /
固定宽度 / overflow，弹窗就会被裁掉一部分（名次表「手动设置名次」就是此问题）。
挂到 body 后弹层相对视口定位，彻底不受页面结构影响。
"""
import os
import re

VIEWS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frontend', 'src', 'views')

TAG_RE = re.compile(r'<(t-dialog|t-drawer)\b')


def find_open_tag_end(src: str, start: int) -> int:
    """从 '<t-dialog' 的 '<' 开始，找到起始标签的结束 '>'（跳过引号内的字符）"""
    i = start
    quote = None
    while i < len(src):
        ch = src[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in ('"', "'"):
            quote = ch
        elif ch == '>':
            return i
        i += 1
    return -1


changed = []
for name in sorted(os.listdir(VIEWS)):
    if not name.endswith('.vue'):
        continue
    path = os.path.join(VIEWS, name)
    src = open(path, encoding='utf-8').read()
    out = src
    delta = 0
    for m in TAG_RE.finditer(src):
        start = m.start() + delta
        end = find_open_tag_end(out, start)
        if end == -1:
            continue
        tag = out[start:end + 1]
        if re.search(r'\battach\s*[:=]', tag):
            continue
        # 自闭合标签（极少见）处理
        if tag.endswith('/>'):
            new_tag = tag[:-2].rstrip() + ' attach="body" />'
        else:
            new_tag = tag[:-1].rstrip() + ' attach="body">'
        out = out[:start] + new_tag + out[end + 1:]
        delta += len(new_tag) - len(tag)
    if out != src:
        n = len(re.findall(r'attach="body"', out)) - len(re.findall(r'attach="body"', src))
        open(path, 'w', encoding='utf-8', newline='').write(out)
        changed.append((name, n))

for name, n in changed:
    print(f'{name}: +{n}')
print('total files:', len(changed))
