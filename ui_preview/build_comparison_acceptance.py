"""Refresh comparison code in a separate acceptance preview, never in production."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from comparison_addon import append_comparison, remove_comparison, validate


def main():
    source = ROOT / 'ui_preview/banner_summit_logo_notes_preview.html'
    target = ROOT / 'ui_preview/banner_summit_comparison_acceptance_preview.html'
    protected = [source, *sorted((ROOT / 'viewer').glob('*.html'))]
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    before = {str(p.relative_to(ROOT)): digest(p) for p in protected}
    original = source.read_bytes().decode('utf-8')
    candidate = append_comparison(original)
    assert remove_comparison(candidate) == remove_comparison(original)
    target.write_bytes(candidate.encode('utf-8'))
    validate(target)
    assert before == {str(p.relative_to(ROOT)): digest(p) for p in protected}
    manifest = {'preview': target.name, 'preview_sha256': digest(target),
                'protected_files_unchanged': before,
                'comparison_sources': {str(p.relative_to(ROOT)): digest(p)
                                       for p in sorted((ROOT / 'viewer_compare').glob('*.js'))}}
    target.with_suffix('.manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Validated {target}; original preview and working pages unchanged.')


if __name__ == '__main__':
    main()
