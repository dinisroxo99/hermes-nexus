"""Build-only, checksum-verified upstream assets. Never shipped as an entrypoint."""
import base64
import hashlib
import io
import pathlib
import tarfile
import urllib.request

ASSETS = (
    ("https://codeload.github.com/oraios/serena/tar.gz/f8f53b77f04e50aadf9e5789841ec6a95c874514",
     "sha256", "2696d5a2d209e2cfb06916fc277509cb7bf9cdadadd59c60b77b75d2882a37a0", "serena"),
    ("https://registry.npmjs.org/pyright/-/pyright-1.1.403.tgz", "sha512",
     base64.b64decode("OyslngwxftKgNfbiyR8WDadUoLHDoinwUfbd50P1VBfLWkR5cro9R52qMQMpVI/LiSVpWbzunToR2NX7SanwmA==").hex(), "pyright"),
)
for url, algorithm, expected, directory in ASSETS:
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    if hashlib.new(algorithm, data).hexdigest() != expected:
        raise ValueError("Upstream checksum mismatch")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            parts = pathlib.PurePosixPath(member.name).parts
            if len(parts) <= 1:
                continue
            member.name = str(pathlib.PurePosixPath(*parts[1:]))
            archive.extract(member, directory, filter="data")
