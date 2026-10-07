"""Browser demos that consume standalone assetc-web output."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMOS = {
    'many-nodes': 'native-scene-many-nodes',
    'mouse-flight': 'native-game-mouse-flight',
    'engine': 'native-scene-aaa',
    'pbr': 'native-scene-pbr',
}
