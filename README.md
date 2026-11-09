# Kerala PWD and KHRI Road Network Survey

The GitHub Pages publishing source is the main branch and the /docs folder. The
site publishes aggregate counts, the Excel workbook and the PDF report.
QFieldCloud data and credentials belong in the surrounding local workspace.

## Refresh on request

From E:\Q Field Project, run:

    python "Road Survey Dashboard/refresh.py"

This uses the existing Daily Backups downloader and requires read access to all
15 projects. It builds from a single complete verified batch. If any download
fails, retain the current published report and resolve access before retrying.
For expired credentials, use the existing local Daily Backups/Setup-ApiAccess.ps1
setup and then re-run the refresh. Work still on surveyors' devices appears only
after it has synced to QFieldCloud.

The build uses Python with ReportLab and Node with the Codex workspace dependency
`@oai/artifact-tool` available to export.mjs. The local node_modules junction can
point to the bundled workspace node_modules. GitHub Pages serves the generated
files directly and has no runtime dependencies.

After a successful refresh, review docs/report.json, docs/road-survey.xlsx and
docs/road-survey.pdf. Commit these three files together and push main. The site
shows both the report build time and the cloud verification time in IST.

For an intentional rebuild from a prior complete verified batch, add
`--snapshot YYYY-MM-DD_HHMMSS_microseconds`. The site labels that source
"Verified backup".
