# rolling back santihdzs.com

The redesign replaced the old site in one commit on `main`, titled "redesign: new portfolio site". The old site is kept
in three places:

- the branch `legacy-site` and the tag `old-site-pre-redesign`, both at `23b500d`, the last commit of the old site
- a zip of the whole old repo, `.git` included, at `~/backups/santihdzs.github.io-2026-10-07.zip` on santi's laptop

Project pages (santihdzs.com/chess/, /fretboard/ and the rest) live in their own repos and are not affected either way.
The custom domain comes from `CNAME`, which both versions contain, so no pages or dns setting changes.

## roll back

This restores the exact files of the old site as a new commit. It works no matter how many daily data commits landed
after the redesign, and it never rewrites history.

```sh
git clone https://github.com/santihdzs/santihdzs.github.io.git
cd santihdzs.github.io
git fetch --tags
git rm -r -q .
git checkout old-site-pre-redesign -- .
git commit -m "rollback: restore the site before the redesign"
git push origin main
```

GitHub pages rebuilds within a couple of minutes. The old tree has no workflow, so the daily data refresh stops too.
If the push is rejected because the data workflow pushed meanwhile, run `git pull --rebase` and push again.

## if the redesign is still the newest commit

A plain revert does the same thing:

```sh
git log --oneline --grep "redesign: new portfolio site"
git revert --no-edit <sha from the line above>
git push origin main
```

Once data commits sit on top, a revert conflicts on `data/`, so use the restore above instead.

## do not

- Do not reset `main` to `legacy-site` and force push. It rewrites public history and is never needed here.
- Do not delete `legacy-site` or `old-site-pre-redesign`.

## if the github repo itself is gone

Unzip the backup, then push its `main` to a new `santihdzs/santihdzs.github.io` repo and set the pages source to
`main` and `/`. The custom domain returns with `CNAME`.

## going forward again

To bring the redesign back after a rollback, revert the rollback commit:

```sh
git log --oneline --grep "rollback: restore the site before the redesign"
git revert --no-edit <sha from the line above>
git push origin main
```
