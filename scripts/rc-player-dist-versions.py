#!/usr/bin/env python3
"""Read player ZIP versions from an rc-players BOM POM on stdin."""

import sys
import xml.etree.ElementTree as ET

DISTRIBUTIONS = ("rc-player-wasm-dist", "remote-compose-player-js-dist")
NAMESPACE = {"m": "http://maven.apache.org/POM/4.0.0"}


def distribution_versions(pom):
    root = ET.fromstring(pom)
    versions = {}
    for dependency in root.findall(
        "m:dependencyManagement/m:dependencies/m:dependency", NAMESPACE
    ):
        group = dependency.findtext("m:groupId", namespaces=NAMESPACE)
        artifact = dependency.findtext("m:artifactId", namespaces=NAMESPACE)
        if group != "ee.schimke.composeai" or artifact not in DISTRIBUTIONS:
            continue
        version = dependency.findtext("m:version", namespaces=NAMESPACE)
        if not version or "${" in version:
            raise ValueError(f"BOM has no concrete version for {artifact}")
        if artifact in versions:
            raise ValueError(f"BOM has duplicate constraints for {artifact}")
        versions[artifact] = version
    for artifact in DISTRIBUTIONS:
        if artifact not in versions:
            raise ValueError(f"BOM does not constrain {artifact}")
    return [(artifact, versions[artifact]) for artifact in DISTRIBUTIONS]


if __name__ == "__main__":
    for artifact, version in distribution_versions(sys.stdin.read()):
        print(f"{artifact}\t{version}")
