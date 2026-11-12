# Cavaco App — Instruções do Projeto

App web (PWA) para treinar cavaquinho, **uso pessoal**. Abre no Chrome Android, sem instalação.
Qualidade de produto profissional, não protótipo. Cada etapa só avança quando funcionar bem no celular real com um cavaco real.

## NOVA PRIORIDADE (decisão do dono)
Jogo estilo karaokê/Guitar Hero: pista de acordes caindo, vídeo atrás sincronizado, o cavaco toca e o app pontua.
Os acordes/tempos são detectados AUTOMATICAMENTE no áudio de vídeos de aulas (acordes já aparecem na tela) + ajuste fino manual.
Limite técnico: o YouTube não expõe áudio/frames do iframe e não há backend → a análise roda sobre ARQUIVO de vídeo/áudio do próprio
usuário, carregado no aparelho (decodeAudioData offline). Não construir baixador de YouTube. O afinador fica por ÚLTIMO.

Ordem: (1) motor de acordes ✅ · (1b) carregar arquivo + análise automática + lista editável ✅ (aba Músicas é a tela inicial) · (2) detector ao vivo (AudioWorklet) · (3) editor de
linha do tempo (ajuste fino) · (4) pista estilo Guitar Hero + pontuação/timing + calibração de latência · (5) biblioteca/PWA ·
(6) batidas · (7) afinador (feito na v0.1, polir por último). Fones são recomendados: o som do vídeo vaza no microfone.

### Leitura dos acordes escritos no vídeo (feito)
Usuário marca o retângulo dos nomes (ex.: faixa superior da aula "Cicinho do cavaco"); OCR local (tesseract.js, ~15 MB em `public/ocr/`,
copiado por `scripts/copy-ocr.mjs` no predev/prebuild, fora do precache) lê 1 quadro/s → `Observation[]` → `buildVocabulary` (trechos, confirma
2 leituras iguais) → `analyzeChords({vocabulary})` restringe o Viterbi a esses acordes (fora da lista = "sem acorde").
Região automática (padrão): `findChordRegion` lê o quadro inteiro em ~20 instantes (OCR com bbox), `pickRegion` vota onde palavras-acorde aparecem sempre no mesmo lugar
→ faixa fina na vertical, largura toda na horizontal. Sem achar → abre o seletor manual. "Ajustar região" continua disponível.
Seletor de região manual: tela cheia, 8 alças (cantos+lados, escolhe a mais próxima), mover, deslizador de tempo e leitura ao vivo. OCR em psm 11 (texto
esparso), 3 ampliações por quadro (64/128/256 px) e votação temporal (janela de 3). Fora da faixa no começo/fim do vídeo = fala → nenhum acorde;
lacuna curta no meio = vale o áudio; lista com ≥3 acordes = restrição forte; 1–2 acordes na tela = dica suave (áudio claro pode discordar).
Modo "um acorde por vez" detectado automaticamente (mediana ≤1 acorde/leitura) + `fillFromVideo`. `VocabEditor`: remover falsos/adicionar faltantes.
Limites conhecidos: OCR erra letras soltas (ex.: "G" lido como "G7" ou perdido); instante das trocas pode atrasar/adiantar até ~1 s.
Detecção de palhetada (feito): `src/audio/onsets.ts` (fluxo espectral log, só aumento de energia) + `refineWithOnsets` (janela ±1 s, ignora ataques fracos): o Viterbi
decide QUAL acorde, a palhetada decide QUANDO troca. Onsets ficam em `SongMeta.onsets` (base para pontuar o jogo). Teste sintético: erro máx. 84→29 ms; trocas de acordes quase
iguais (G7→G) com voz forte ainda podem errar ~1 s. Editor: "Grudar na palhetada mais próxima". Apagar = um botão (anterior continua; repetidos juntam).
Persistência: cada edição salva na hora (fila, sem debounce), "Desfazer" (40 níveis), inserir acorde divide o acorde atual (`insertChord`), ajuste de início E fim,
backup/restauração em JSON (`exportBackup`/`importBackup`; músicas importadas ficam `needsFile` até o usuário escolher o vídeo). O app mostra se o armazenamento está protegido
(`navigator.storage.persist`). Hipótese para "perdi as edições ao recarregar": armazenamento separado por onde o link é aberto (aba do app de chat × Chrome × PWA instalado) —
orientar a instalar na tela inicial e abrir sempre por ele.
Player (Android Chrome é o ponto frágil; não reproduzível no desktop): vigia de 6 s + `onError` + detector de "deu play e não andou" → plano B automático (copia o Blob p/ memória; na 1ª carga
usa `blobRef`, pois o arquivo só vai ao IndexedDB depois da análise) → cartão com diagnóstico copiável + "Tocar só o áudio" (<audio>, acordes seguem sincronizados). OCR fica desabilitado nesse modo.
Pendente: destacar trechos onde áudio e vídeo discordam.

## Módulos (histórico)
1. Afinador ✅ (v0.1)
2. Detector de acordes (motor de áudio)
3. Cifras com rolagem inteligente (score following)
4. Motor de batidas (samples reais em `public/samples/`, lookahead scheduler, swing)
5. Modo jogo com fases

## Por que as versões anteriores falharam
No-code + JS remendado (latência/detecção ruins) → aqui: código próprio, tipado e testado.
Batidas sintetizadas → aqui: só samples reais + swing correto.
Tudo de uma vez → aqui: por etapas com critério de pronto.

## Stack
Vite + TypeScript (strict) + React · Web Audio + AudioWorklet (nada de ScriptProcessorNode) · PWA (manifest + SW) ·
sem backend (IndexedDB/localStorage, exportar/importar JSON) · Vitest · deploy GitHub Pages via Actions a cada push na `main`
(`base` do Vite = nome do repositório: `/BORA1/`).

## Regras de trabalho
- Mobile-first (celular em pé, botões grandes, cavaco no colo). Interface em pt-BR. Visual escuro e limpo.
- Ao terminar cada tarefa: rodar testes, build, commit, push e dizer o que testar no celular.
- Tela de diagnóstico oculta (hoje: tocar 5× no título, ou `#debug`): nível do mic, frequência, cromagrama, acorde detectado.
- Nunca entregar recurso "mais ou menos": se não ficou bom, dizer claramente.

## Cavaquinho — referência
Padrão Ré-Sol-Si-Ré: D4 293,66 · G4 392,00 · B4 493,88 · D5 587,33 Hz. Alternativas configuráveis. 4 cordas, ~17 trastes.

## Critérios de pronto
- **M1 Afinador:** ±2 cents nas 4 cordas, estável, sem pular de nota.
- **M2 Acordes:** pagode/samba comuns (C, G7, Am, Dm, E7, F, A7, Bm7(b5)…) com acerto alto e < ~300 ms.
  Pipeline mic → FFT → cromagrama (pesos de harmônicos, faixa do cavaco) → modelos → suavização; onsets; top 3 + confiança; calibração.
  Tipos: maior, menor, 7, m7, 7M, dim, m7(b5), 6, m6, 9, sus4, aum.
- **M3 Cifras:** parser (acorde sobre a letra e `[C]inline`), transposição, biblioteca, diagramas validados por teste,
  seguidor que avança ao confirmar o próximo acorde, para quando paro, realinha em janela, usa onsets para acordes repetidos,
  controles manuais sempre disponíveis. Pronto = tocar uma música inteira sem tocar no celular.
- **M4 Batidas:** só samples reais (placeholders sinalizados), lookahead scheduler, padrões por estilo com swing próprio,
  variação humana, BPM/estilo salvos por música. Pronto = soa como roda, não metrônomo.

## Estrutura
`src/{audio,chords,tuner,songs,rhythm,game,ui,storage}` · `public/samples/` · `tests/`
