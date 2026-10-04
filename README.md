# Dom v Kynku

Pracovný web projektu rodinného domu – https://pankevely.github.io/kynek-dom/

- `index.html`, `css/`, `js/` – aplikácia (statická, bez build kroku; knižnice sú v `js/vendor/`)
- `content/` – zápisník: Markdown súbory + `index.json` (zoznam, kategórie, dátumy, „na čo čakáme“)
- `data/` – generované z modelu skriptom `tools/build_data.py` (mimo repozitára) – needitovať ručne
- `robots.txt` + `noindex` – stránka sa neindexuje vo vyhľadávačoch, nie je chránená heslom

Úprava textu: uprav `.md` v `content/`, pri novom súbore doplň záznam do `content/index.json` (a zmeň `updated`).
