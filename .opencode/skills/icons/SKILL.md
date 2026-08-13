---
name: icons
description: Add or change UI icons/glyphs in the Primitivão app. Use whenever a visual symbol is needed in the UI — the project FORBIDS Unicode emojis; everything uses the inline-SVG <Icon name="..."> component. Covers the no-emoji CI rule (which blocks the push) and how to add a new icon case.
---

# Ícones — SEM EMOJIS

Regra absoluta: **nada de emoji Unicode na UI** (🏆🎯⚠ etc). Toda decoração usa
`<Icon name="..." size={N} />` — SVG inline, `viewBox 24x24`, cor via `currentColor`.
Definido em `function Icon(...)` no `apostas/apostas-app.jsx`.

## Adicionar um ícone
1. Abra o `switch (name)` em `function Icon(...)`.
2. Novo `case 'nome': return (<svg {...common}>...</svg>);`
3. `stroke="currentColor" fill="none"` (lineart) OU `fill="currentColor"` (sólido).
   Desenhe no viewBox 24x24. Use `strokeLinecap/strokeLinejoin="round"` pra suavizar.
4. Documente o nome na lista do `CLAUDE.md §1`.

## CI no-emoji (bloqueia o push — lint.yml)
Varre ranges de emoji em linhas que não são comentário. Rodar local antes:
```
node -e "const fs=require('fs');const s=fs.readFileSync('apostas/apostas-app.jsx','utf8');const re=/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2700}-\u{27BF}★☆⚙⚠⚡⚽⚾⛳⛔]/gu;const bad=[];s.split('\n').forEach((l,i)=>{const t=l.trim();if(t.startsWith('//')||t.startsWith('*'))return;if(/[\u{1F1E6}-\u{1F1FF}]/u.test(l))return;if(re.test(l))bad.push(i+1)});console.log(bad.length?'EMOJI@'+bad:'OK')"
```
**Permitido**: bandeiras nacionais (conteúdo da Copa) e caracteres **CJK** (闘 球 速…
são texto decorativo no tabloide, não emoji — passam no check).

## Onde usar
- Catálogo renderizado: **ADMIN → CATÁLOGO**. Lista textual no `CLAUDE.md §1`.
- Ícone temático por campeonato no tabloide: `TABLOID_THEMES[champId].icon`
  (ver skill `tabloid`). Mantenha cada campeonato com um ícone DISTINTO.
- Prefira reusar ícones já bem-desenhados (skull, target, sword, rocket, football,
  flag, globe, crown, fire, trophy…) antes de desenhar um novo do zero.
