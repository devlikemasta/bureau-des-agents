# Kancelarija agenata

**Stanje (06.11.2026):** v1 + Maxov sto (duge radnje) i Max na sredini kad nema posla; radi i pushovana na granu `posmatrac` (fork `Stefn10/kancelarija-agenata`). Faze 0 do 5 gotove. Sledeće (nije zakazano): širenje kancelarije preko 6 odeljenja, brisanje Maxovog koda.

Pixel-art kancelarija u browseru (`http://localhost:4848`) koja uživo prikazuje agente iz naših Claude Code sesija. Chat je šef; kancelarija ništa ne pokreće i ne troši tokene. Osnova: open source [Bureau des agents](https://github.com/devlikemasta/bureau-des-agents) (MIT).

## Upotreba
- `/kancelarija` u bilo kojoj sesiji (skill `~/.claude/skills/kancelarija/SKILL.md`): pali server, bira projekat po folderu, prijavljuje sesiju, otvara tab.
- Agent ide u odeljenje po prefiksu u opisu: `[Transkripcija] RMA čas 5`.
- Klik na lika: model, tokeni, alati. Klik na tablu: plan + tvoje stavke. Klik na policu: današnji log i ukupni tokeni. Klik na Maxov sto: duge radnje (pozadinske komande + `scripts/napredak.mjs`) sa procentom.
- Max bez posla (45 s bez svoje radnje i bez radnika) stoji na sredini kancelarije; kad uđe radnik ili Max nešto radi, seda za sto.

## Gde je šta
| Šta | Gde |
|---|---|
| Plan, odluke, rezultati faza | `~/.claude/plans/kancelarija-agenata.md` |
| Hook (šalje događaje) | `hooks/kancelarija-hook.mjs`, registrovan u `~/.claude/settings.json` (SubagentStart/Stop, Pre/PostToolUse, SessionEnd, UserPromptSubmit) |
| Posmatrač, projekti, tabla, dnevnik | `server/observer.ts`, `server/projekti.ts`, `server/tabla.ts`, `server/dnevnik.ts` |
| Skripte | `scripts/kancelarija.sh upali\|ugasi\|status`, `prijavi.mjs`, `projekat.mjs`, `tabla.mjs`, `pusti-snimak.mjs` |
| Podaci | `~/.kancelarija/` (`aktivno.json`, `projekti/`, `tabla/`, `log/`, `bureau/`, `server.log`) |
| Projekti sa odeljenjima | `raf`, `bce`, `kancelarija-razvoj` |

## Odluke koje važe
- Francuski glas Maxa i vođena tura ostaju (Stefan, 06.11.2026).
- Do 6 odeljenja; višak sedi za pomoćnim stolom.
- Tokeni = kontekst poslednjeg poteza agenta (isto kao Claude-ov `subagent_tokens`).
- Hookovi ne javljaju neuspeh podagenta: crveno stanje greške samo kad se sesija ugasi dok agent radi.
