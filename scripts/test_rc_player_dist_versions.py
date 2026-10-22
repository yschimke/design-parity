import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "dist_versions", Path(__file__).with_name("rc-player-dist-versions.py")
)
dist_versions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dist_versions)


def bom(dependencies):
    return f'''<project xmlns="http://maven.apache.org/POM/4.0.0">
      <version>2.17.1</version><dependencyManagement><dependencies>
      {dependencies}</dependencies></dependencyManagement></project>'''


def dependency(artifact, version):
    return f'''<dependency><groupId>ee.schimke.composeai</groupId>
      <artifactId>{artifact}</artifactId><version>{version}</version></dependency>'''


class DistributionVersionsTest(unittest.TestCase):
    def test_partial_release_uses_each_constraint_instead_of_bom_version(self):
        pom = bom(dependency("rc-player-wasm-dist", "2.17.1") +
                  dependency("remote-compose-player-js-dist", "2.17.0"))
        self.assertEqual(dist_versions.distribution_versions(pom), [
            ("rc-player-wasm-dist", "2.17.1"),
            ("remote-compose-player-js-dist", "2.17.0"),
        ])

    def test_missing_distribution_fails_instead_of_guessing_release_version(self):
        with self.assertRaisesRegex(ValueError, "does not constrain remote-compose-player-js-dist"):
            dist_versions.distribution_versions(bom(dependency("rc-player-wasm-dist", "2.17.1")))

    def test_unresolved_property_fails(self):
        with self.assertRaisesRegex(ValueError, "no concrete version"):
            dist_versions.distribution_versions(bom(dependency("rc-player-wasm-dist", "${missing}")))

    def test_duplicate_distribution_fails(self):
        with self.assertRaisesRegex(ValueError, "duplicate constraints"):
            dist_versions.distribution_versions(bom(dependency("rc-player-wasm-dist", "2.17.0") * 2))

    def test_ci_uses_resolved_versions_for_downloads(self):
        workflow = Path(__file__).parents[1].joinpath(".github/workflows/ci.yml").read_text()
        self.assertIn('python3 scripts/rc-player-dist-versions.py < "$root-bom.pom"', workflow)
        self.assertIn('$artifact/$version/$artifact-$version-dist.zip', workflow)
        self.assertNotIn('$artifact/$RC_PLAYERS_VERSION/$artifact-$RC_PLAYERS_VERSION-dist.zip', workflow)


if __name__ == "__main__":
    unittest.main()
