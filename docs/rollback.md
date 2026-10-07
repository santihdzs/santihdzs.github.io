# rolling back santihdzs.com

The redesign replaced the old site in one commit on `main`, titled "redesign: new portfolio site". The old site is kept
on GitHub, in this repo, as two refs that both point at `23b500d`, the last commit of the old site:

- the branch `legacy-site`
- the tag `old-site-pre-redesign`

They are the only backup. Never delete them, and never delete this repo.

Project pages (santihdzs.com/chess/, /fretboard/ and the rest) live in their own repos and are not affected either way.
The custom domain comes from `CNAME`, which both versions contain, so no pages or dns setting changes.

## check the backup

```sh
git ls-remote https://github.com/santihdzs/santihdzs.github.io.git refs/heads/legacy-site "refs/tags/old-site-pre-redesign^{}"
```

Both lines must start with `23b500d`.

## roll back

This restores the exact files of the old site as a new commit. It works no matter how many commits landed after the
redesign, and it never rewrites history.

```sh
git clone https://github.com/santihdzs/santihdzs.github.io.git
cd santihdzs.github.io
git rm -r -q .
git checkout old-site-pre-redesign -- .
git commit -m "rollback: restore the site before the redesign"
git push origin main
```

GitHub pages rebuilds within a couple of minutes. The old tree has no workflow, so the daily data refresh stops too.

If the push is rejected because the data workflow pushed in the meantime, drop the unpushed rollback commit and redo it
on top of the new `main`:

```sh
git fetch origin
git reset --hard origin/main
git rm -r -q .
git checkout old-site-pre-redesign -- .
git commit -m "rollback: restore the site before the redesign"
git push origin main
```

## do not

- Do not reset `main` to `legacy-site` and force push. It rewrites public history and is never needed here.
- Do not `git revert` the redesign commit. Later commits touch the same files, so the revert conflicts.
- Do not delete `legacy-site` or `old-site-pre-redesign`.

## going forward again

To bring the redesign back after a rollback, revert the rollback commit:

```sh
git log --oneline --grep "rollback: restore the site before the redesign"
git revert --no-edit <sha from the line above>
git push origin main
```
