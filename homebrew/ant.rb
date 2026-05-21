# Homebrew formula for ant — fresh-ANT CLI (m6.1 Phase-6 distribution rail).
#
# This file lives in the source repo (CascadeProjects/ant/homebrew/ant.rb)
# for reference + CI bookkeeping. The version that users actually install
# lives in the tap repo:
#   https://github.com/Jktfe/homebrew-antchat (Formula/ant.rb)
#
# Per JWPK 2026-05-14 direction: pragmatic v1 reuses the existing
# `Jktfe/homebrew-antchat` tap rather than spinning a new
# `Jktfe/homebrew-ant`. Brand consolidation lands later.
#
# Release artifacts ship from `Jktfe/a-nice-terminal` (alongside antchat
# for v1). When fresh-ANT moves to its own GitHub repo, swap the
# `url` host fields below.
#
# The release workflow emits a GitHub Release tagged `ant-v<version>`
# with two binary tarballs (arm64 + x64 darwin) and a SHA256SUMS file.
# After tagging, `homebrew/update-tap.sh <version>` substitutes the new
# version + hashes into Formula/ant.rb in the tap repo.
#
# Install (after first release published):
#   brew tap jktfe/antchat
#   brew install ant
#
# Or directly:
#   brew install jktfe/antchat/ant
class Ant < Formula
  desc "Fresh-ANT CLI — agent coordination + chat from your terminal"
  homepage "https://github.com/Jktfe/a-nice-terminal"
  # NOTE: version below matches `ant --version` on the current build.
  # m6.1 T3 release pipeline bumps this to the real semver via
  # homebrew/update-tap.sh at release-tag time. Until then `brew test`
  # cannot actually run (no published asset), so the assertion below is
  # documented-pending rather than load-bearing.
  version "0.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/Jktfe/a-nice-terminal/releases/download/ant-v#{version}/ant-#{version}-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_ARM64_SHA256_REPLACE_AT_RELEASE_TIME"
    end
    on_intel do
      url "https://github.com/Jktfe/a-nice-terminal/releases/download/ant-v#{version}/ant-#{version}-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_X64_SHA256_REPLACE_AT_RELEASE_TIME"
    end
  end

  def install
    bin.install "ant"
  end

  test do
    # Two cheap, network-free assertions: the binary boots, and its
    # self-reported version matches the formula version. m6.1 T1 wired
    # ant-cli-version-helper.mjs so `ant --version` prints `ant <semver>`.
    # This block becomes live once m6.1 T3 ships the first ant-v<version>
    # GitHub release; update-tap.sh substitutes both `version` above and
    # the SHA256 placeholders so `ant --version` matches the formula.
    assert_match version.to_s, shell_output("#{bin}/ant --version")
    assert_match "fresh-ant CLI", shell_output("#{bin}/ant --help")
  end
end
