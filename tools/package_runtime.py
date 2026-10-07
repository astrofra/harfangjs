"""Audit and copy the browser runtime, removing obsolete modules from releases."""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
IMPORTS = re.compile(r'''(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']''')


def audit_runtime(source=ROOT / 'src'):
    source = Path(source).resolve()
    visited = set()

    def visit(path):
        path = path.resolve()
        if not path.is_relative_to(source) or not path.is_file():
            raise ValueError(f'Unresolved runtime module: {path}')
        if path in visited:
            return
        visited.add(path)
        text = re.sub(r'(?m)^\s*//.*$', '', path.read_text(encoding='utf-8'))
        for name in IMPORTS.findall(text):
            if not name.startswith('.'):
                raise ValueError(f'Unexpected runtime dependency {name} in {path}')
            visit(path.parent / name)

    for entry in ('index.js', 'browser.js'):
        visit(source / entry)
    unused = set(source.rglob('*.js')) - visited
    if unused:
        raise ValueError(f'Unreachable runtime modules: {sorted(str(p.relative_to(source)) for p in unused)}')
    return sorted(p.relative_to(source) for p in visited)


def package_runtime(source, target):
    source, target = Path(source).resolve(), Path(target).absolute()
    # Only generated runtime copies inside this repository's dist can be cleaned.
    dist = ROOT.resolve() / 'dist'
    if target.resolve() != target or not target.is_relative_to(dist) or target == dist:
        raise ValueError(f'Unsafe runtime release path: {target}')
    paths = audit_runtime(source)
    existing = list(target.rglob('*'))
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in existing):
        raise ValueError(f'Links are unsupported in runtime releases: {target}')
    for path in existing:
        if path.is_file() and path.relative_to(target) not in paths:
            path.unlink()
    for relative in paths:
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, destination)


if __name__ == '__main__':
    print(f'Browser runtime: {len(audit_runtime())} reachable modules; imports resolved.')
