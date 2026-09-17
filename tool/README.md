# Atlas place review tool

Private local admin tool. It does not change the public website code.

```bash
cd ~/Downloads/lko2/tool
npm install
npm start
```

Open `http://localhost:4173`.

The tool reads open GitHub issues labelled `suggestion`. It can also research a manually typed place. Research uses supported Serper.dev Google Search, Google Images and Google Maps endpoints plus Wikipedia, OpenStreetMap/Nominatim and Wikimedia Commons. Raw search-page scraping is not used. Every result must be reviewed before adding.

Open **Settings** and add at least one free API key:

- Serper.dev (`SERPER_KEY` can also be used)

Keys entered in the UI are stored only in ignored `tool/config.json` with owner-only file permissions. Serper.dev supplies Google web, image and map results.

Adding a place creates a timestamped `sites.json` backup under `tool/backups/`, downloads 1–8 selected photographs into a new `img/` folder, validates and converts them to JPEG, checks them against existing Atlas photos, then atomically replaces `sites.json`. A transaction journal repairs an interrupted add automatically at the next launch.

Set `GITHUB_TOKEN` before starting only if you want successfully added suggestions to be commented on and closed automatically. The token needs Issues read/write access for this repository. Without it, issue fetching and adding places still work; the issue remains open.
