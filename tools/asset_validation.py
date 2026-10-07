"""Independent decoded-payload checks for validators (not build dependencies)."""
import hashlib


def read_asset(path, entry):
    data = path.read_bytes()
    if entry.get('compression') == 'lz4-block':
        import lz4.block
        assert len(data) == entry['storedByteLength']
        assert hashlib.sha256(data).hexdigest() == entry['storedSha256']
        data = lz4.block.decompress(data, uncompressed_size=entry['byteLength'])
    else:
        assert 'compression' not in entry
    assert len(data) == entry['byteLength']
    assert hashlib.sha256(data).hexdigest() == entry['sha256']
    return data
