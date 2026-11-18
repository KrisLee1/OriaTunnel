<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<h1 align="center">원격 관리를 위한 하나의 SSH 작업 공간</h1>

<p align="center">OriaTunnel에서 SSH 터널, 원격 서비스, 터미널, 파일 전송과 원격 데스크톱을 한곳에서 관리하세요.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · 한국어 · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

**[다운로드 및 설치](#다운로드-및-설치)** · [빠른 시작](#빠른-시작) · [전체 사용자 가이드(중국어 간체)](../USAGE.md) · [온라인 데모(중국어 간체)](https://oriamade.com/zh-CN/oria-tunnel#workspace)

## 주요 기능

### 🔗 연결 지도로 관리하는 SSH 터널

- 연결 지도에서 로컬 포트와 SSH 호스트의 연결 관계를 확인하세요. 규칙을 개별 또는 일괄로 시작하거나 중지하고 연결 상태, 활성 연결 수와 트래픽을 확인할 수 있습니다.
- 기존 SSH 설정에서 호스트를 선택하거나 직접 추가하세요. 비밀번호, 개인 키, 시스템 SSH 에이전트 인증과 여러 경유 호스트를 거치는 연결(ProxyJump)을 지원합니다.
- 규칙을 저장해 두면 지도에서 내부 웹 페이지를 다시 열거나 로컬 데이터베이스 클라이언트로 포워딩 포트에 접속할 수 있습니다.

### ⚙️ 원격 서비스 관리

- 서비스 시작, 중지, 재시작, 상태 확인과 로그 조회 명령을 템플릿으로 저장하세요. 포워딩에 연결하면 서비스 메뉴에서 각 명령을 실행할 수 있습니다.
- 서비스를 먼저 실행해야 한다면 시작 명령과 상태 검사를 설정하세요. 서비스 시작부터 검사와 터널 연결까지 단계별 결과를 확인할 수 있습니다.

### 💻 로컬 및 SSH 터미널

- 탭으로 로컬 세션과 원격 세션을 전환하세요. 입력 중에 완성 후보를 확인하고 ↑ 키로 기록을 찾거나, 다른 세션에서 저장한 명령을 키워드로 불러올 수 있습니다.
- Shift+Enter로 여러 줄을 편집하고 디렉터리를 바꾼 뒤에도 작성 중이던 명령을 이어 쓰세요. 긴 출력은 접을 수 있고 명령과 결과를 따로 복사할 수 있습니다.

### 📁 파일 전송

- 두 패널에 로컬 디렉터리와 원격 디렉터리를 나란히 열고 파일을 끌어다 놓아 일괄 업로드하거나 다운로드하세요. 각 패널에 다른 SSH 호스트를 열면 호스트 간 전송도 가능합니다.
- 백그라운드 대기열에서 묶음별 진행 상황을 보고 작업을 일시 중지하거나 재개 또는 취소할 수 있습니다. 파일 미리 보기와 텍스트 편집도 지원합니다.

### 🖥️ VNC 원격 데스크톱

- VNC 포워딩에서 별도 창을 열어 SSH 터널로 원격 데스크톱에 접속하세요. 전체 화면, 확대·축소, 양방향 텍스트 복사와 붙여넣기를 지원합니다.
- 데스크톱 창에서 SSH 터미널을 열거나 SFTP로 파일을 주고받을 수 있습니다. 창을 닫아도 대기열에 등록한 전송은 계속됩니다.

## 다운로드 및 설치

| 플랫폼 | 설치 파일 v0.4.0 | 설치 방법 |
| --- | --- | --- |
| macOS | [Apple Silicon](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.0/OriaTunnel_0.4.0_aarch64.dmg) · [Intel](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.0/OriaTunnel_0.4.0_x64.dmg) | 디스크 이미지를 열고 OriaTunnel을 응용 프로그램 폴더로 드래그하세요. |
| Windows | [x64](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.0/OriaTunnel_0.4.0_x64-setup.exe) · [ARM64](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.0/OriaTunnel_0.4.0_arm64-setup.exe) | 설치 프로그램을 실행하고 안내를 따르세요. |

### 버전 기록

**v0.4.0** · 로컬 및 SSH 터미널에 명령 자동 완성, 세션 간 공유 명령 라이브러리, 여러 줄 편집과 긴 출력 접기가 추가되었습니다. 앱 정보에서 업데이트를 확인할 수 있습니다.

[릴리스 노트(중국어 간체)](../releases/v0.4.0.md) · [전체 버전](https://github.com/KrisLee1/OriaTunnel/releases)

## 빠른 시작

SSH 서버의 3000번 포트에서 실행 중인 웹 서비스를 로컬 브라우저로 여는 예시입니다.

1. OriaTunnel을 열고 **호스트 추가**를 선택합니다. SSH 설정에서 발견한 호스트를 선택하거나 연결 정보를 직접 입력하세요. 호스트 탐색은 설정만 읽으며 자동으로 연결하지 않습니다.
2. **새 포워딩**에서 호스트와 로컬 포워딩(L)을 선택하세요. 로컬 수신 주소는 `127.0.0.1:13000`, 대상은 SSH 서버 자체의 `127.0.0.1:3000`으로 설정하세요.
3. **저장 후 시작**을 선택하고 안내에 따라 인증합니다. 처음 연결할 때는 서버 지문을 확인하세요. 규칙에 **수신 대기 중**이 표시되면 로컬 브라우저에서 `http://127.0.0.1:13000`을 여세요.

다음부터는 저장한 규칙을 시작하면 됩니다. 페이지가 열리지 않으면 대상 포트에서 원격 서비스가 실행 중인지 확인하세요. [문제 해결 가이드(중국어 간체)](../USAGE.md#查看状态与排查问题)

### 포워딩 방식 선택

| 방식 | 사용 상황 | 서비스 접근 방법 |
| --- | --- | --- |
| **L · 로컬 포워딩** | 이 컴퓨터에서 서버의 웹 앱, 데이터베이스, VNC 서비스에 접근 | 로컬 수신 포트에 연결하면 SSH를 통해 원격 서비스에 접근합니다 |
| **R · 원격 포워딩** | 서버에서 이 컴퓨터의 개발 서비스에 접근 | 서버의 수신 포트에 연결하면 SSH를 통해 로컬 서비스에 접근합니다 |
| **D · 동적 포워딩** | SSH 호스트를 통해 여러 내부 주소에 접근 | 메뉴에서 독립 프록시 브라우저를 열거나 다른 클라이언트에 로컬 SOCKS5를 설정합니다 |

OriaTunnel 설정 파일이 있다면 포워딩 페이지에서 가져온 뒤 내용을 검토하고 자신의 인증 정보를 입력하여 시작하세요. 가져온 서비스 템플릿은 검토 후 실행을 활성화해야 합니다. [기존 설정 사용(중국어 간체)](../USAGE.md#使用现成配置)을 참고하세요.

## 화면 미리 보기

OriaMadeWeb의 OriaTunnel 데모에서 예시 데이터로 구성한 화면입니다. 테마에 따라 밝은 화면이나 어두운 화면으로 표시됩니다.

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/connection-map-dark.png"><img src="../assets/screenshots/connection-map-light.png" alt="연결 맵"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/terminal-dark.png"><img src="../assets/screenshots/terminal-light.png" alt="터미널 명령 라이브러리"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/files-dark.png"><img src="../assets/screenshots/files-light.png" alt="파일 전송 대기열"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vnc-dark.png"><img src="../assets/screenshots/vnc-light.png" alt="VNC 원격 데스크톱"></picture> |

<details>
<summary>다른 화면 보기</summary>

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/forwards-dark.png"><img src="../assets/screenshots/forwards-light.png" alt="포워딩 규칙"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/services-dark.png"><img src="../assets/screenshots/services-light.png" alt="서비스"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/hosts-dark.png"><img src="../assets/screenshots/hosts-light.png" alt="SSH 호스트"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/logs-dark.png"><img src="../assets/screenshots/logs-light.png" alt="활동 로그"></picture> |

</details>

## 문서 및 지원

[전체 사용자 가이드(중국어 간체)](../USAGE.md) · [문제 해결 가이드(중국어 간체)](../USAGE.md#查看状态与排查问题) · [개발 가이드(중국어 간체)](../DEVELOPMENT.md) · [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues)

## 라이선스

Copyright (C) 2026 KrisLee.

OriaTunnel은 **GNU General Public License 버전 3만 적용하는 GPL-3.0-only**로 제공됩니다. 전체 조건은 [LICENSE](../../LICENSE)를 참고하세요.

이 소프트웨어는 라이선스에 명시된 대로 어떠한 보증도 없이 제공됩니다. 타사 코드, 의존성, 리소스에는 각각의 라이선스와 고지가 적용됩니다. 포함된 타사 라이선스는 [docs/licenses](../licenses)에서 확인할 수 있습니다.
