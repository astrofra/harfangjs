"""Publish only the compiler's current, verified assets into a Web release."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil


def package_assets(source, target):
    source, target = Path(source).resolve(), Path(target).absolute()
    parent = target.parent.resolve()
    target = parent / target.name
    staging = parent / (target.name + '.building')
    backup = parent / (target.name + '.previous')

    def owned(path):
        if path not in (target, staging, backup) or path.resolve() != path or path.parent != parent:
            raise ValueError(f'Unsafe compiled release path: {path}')
        if not (path / 'manifest.json').is_file():
            raise ValueError(f'Refusing unmarked compiled release: {path}')
        for child in path.rglob('*'):
            if child.is_symlink() or getattr(child, 'is_junction', lambda: False)():
                raise ValueError(f'Links are unsupported in compiled releases: {child}')

    manifest_bytes = (source / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest['schema'] != 'harfang-web-program-assets/1':
        raise ValueError('Expected native Web compiler output')
    # Validate before replacing any previous release, including all file paths.
    payloads = {}
    for logical_id, entry in manifest['assets'].items():
        relative = PurePosixPath(entry['uri'])
        allowed = {logical_id}
        if entry.get('compression') == 'lz4-block':
            allowed.add(logical_id + '.lz4')
        if entry['uri'] not in allowed or relative.is_absolute() or '..' in relative.parts or '\\' in logical_id or ':' in logical_id:
            raise ValueError(f'Expected a relative original asset path: {logical_id}')
        data = (source / relative).read_bytes()
        if entry.get('compression') == 'lz4-block':
            size, checksum = entry['storedByteLength'], entry['storedSha256']
            if not isinstance(size, int) or not 0 < size < entry['byteLength']:
                raise ValueError(f'Invalid compressed asset size: {logical_id}')
        elif 'compression' in entry or 'storedByteLength' in entry or 'storedSha256' in entry:
            raise ValueError(f'Unsupported asset storage: {logical_id}')
        else:
            size, checksum = entry['byteLength'], entry['sha256']
        # Verify the exact published bytes. The browser also verifies the
        # decoded hash; packaging requires no Python compression dependency.
        if len(data) != size or hashlib.sha256(data).hexdigest() != checksum:
            raise ValueError(f'Corrupt compiled asset: {logical_id}')
        payloads[relative] = data
    if target.exists():
        owned(target)
    if staging.exists() or backup.exists():
        raise ValueError(f'Interrupted asset publication needs recovery: {staging} or {backup}')
    saved = False
    try:
        staging.mkdir(parents=True)
        (staging / 'manifest.json').write_bytes(manifest_bytes)
        for relative, data in payloads.items():
            path = staging / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        owned(staging)
        if target.exists():
            owned(target)
            target.rename(backup)
            saved = True
        try:
            staging.rename(target)
        except Exception:
            if saved:
                owned(backup)
                backup.rename(target)
            raise
    except Exception:
        if staging.exists() and (staging / 'manifest.json').exists():
            owned(staging)
            shutil.rmtree(staging)
        raise
    if saved:
        owned(backup)
        shutil.rmtree(backup)
