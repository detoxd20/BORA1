# Cavaco

PWA para treinar cavaquinho. Veja `CLAUDE.md` para a visão do projeto.

```bash
npm install
npm run dev       # desenvolvimento (microfone exige localhost ou HTTPS)
npm test          # Vitest
npm run build     # typecheck + build em dist/
```

## Deploy
`.github/workflows/deploy.yml` publica no GitHub Pages a cada push na `main`
(em *Settings → Pages → Source* escolha **GitHub Actions**). Endereço: `https://<usuário>.github.io/BORA1/`.
