#!/usr/bin/env bash
# Sets up AWS CLI + SSO + CodeArtifact auth for local/devcontainer development.
# See https://tech-portal.kgp-tools.com/docs/tech-platform/developer-access/aws-identity-center
# and https://tech-portal.kgp-tools.com/docs/tech-platform/developer-access/aws-codeartifact
# for the manual steps this automates.
set -euo pipefail

SSO_SESSION="kto"
SSO_START_URL="https://identitycenter.amazonaws.com/ssoins-69879e1c2cd76fc0"
SSO_REGION="eu-central-1"

PROFILE="kto-com-dev"
ACCOUNT_ID="176880429926"
ROLE_NAME="${KTO_AWS_ROLE_NAME:-kto-tech-dev-frontend-dev}"
REGION="eu-west-1"

CODEARTIFACT_DOMAIN="kto-group"
CODEARTIFACT_DOMAIN_OWNER="472461109365"
CODEARTIFACT_REPOSITORY="npm-proxy"

os="$(uname -s)"

if ! command -v aws >/dev/null 2>&1; then
  echo "Installing AWS CLI..."
  case "$os" in
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew not found — install it from https://brew.sh, then re-run this script." >&2
        exit 1
      fi
      brew install awscli
      ;;
    Linux)
      arch="$(uname -m)"
      case "$arch" in
        x86_64) aws_arch="x86_64" ;;
        aarch64|arm64) aws_arch="aarch64" ;;
        *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
      esac
      tmp_dir="$(mktemp -d)"
      curl -s "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" -o "${tmp_dir}/awscliv2.zip"
      unzip -q -o "${tmp_dir}/awscliv2.zip" -d "${tmp_dir}"
      sudo "${tmp_dir}/aws/install" >/dev/null
      rm -rf "${tmp_dir}"
      ;;
    *)
      echo "Unsupported OS: $os" >&2
      exit 1
      ;;
  esac
  echo "AWS CLI installed: $(aws --version)"
fi

if ! aws configure list-profiles 2>/dev/null | grep -qx "$PROFILE"; then
  echo "Configuring SSO profile '${PROFILE}'..."
  mkdir -p ~/.aws
  cat >> ~/.aws/config <<EOF

[profile ${PROFILE}]
sso_session = ${SSO_SESSION}
sso_account_id = ${ACCOUNT_ID}
sso_role_name = ${ROLE_NAME}
region = ${REGION}
output = json

[sso-session ${SSO_SESSION}]
sso_start_url = ${SSO_START_URL}
sso_region = ${SSO_REGION}
sso_registration_scopes = sso:account:access
EOF
fi

if ! aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1; then
  echo "SSO session expired or missing — opening browser login for '${PROFILE}'..."
  sso_login_args=(--profile "$PROFILE")
  if [ "$os" = "Linux" ]; then
    # Devcontainer runs Linux; the SSO callback listener binds inside the
    # container and isn't reachable from the host browser, so use the
    # device-code flow instead of the local-redirect flow.
    sso_login_args+=(--use-device-code)
  fi
  aws sso login "${sso_login_args[@]}"
fi

echo "Refreshing CodeArtifact token for pnpm/npm..."
aws codeartifact login \
  --tool npm \
  --repository "$CODEARTIFACT_REPOSITORY" \
  --domain "$CODEARTIFACT_DOMAIN" \
  --domain-owner "$CODEARTIFACT_DOMAIN_OWNER" \
  --region "$REGION" \
  --profile "$PROFILE"

echo "AWS + CodeArtifact setup complete."
