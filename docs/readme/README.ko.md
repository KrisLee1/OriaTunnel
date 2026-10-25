<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">SSH 터널을 시각적으로 관리하고 원격 서비스를 간편하게 사용하세요.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · 한국어 · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

OriaTunnel은 Windows와 macOS용 SSH 터널 및 원격 서비스 관리 도구입니다. 시각적인 인터페이스에서 여러 서버, 터널, 서비스를 한곳에서 관리하세요. 복잡한 포워딩 명령을 외우지 않아도 내부망 데이터베이스, 웹 관리 화면, 개발 환경에 접속하고 미리 설정한 서비스 작업을 실행할 수 있습니다.

호스트와 포워딩 규칙을 저장하면 평소에는 화면에서 시작, 중지, 서비스 열기를 선택하면 됩니다. SSH 명령에 익숙하지 않은 사용자도 관리자나 동료가 준비한 설정을 가져와 자신의 인증 정보를 입력한 뒤 사용할 수 있습니다.

현재 버전: **v0.1.0** · [버전 기록](#버전-기록)

**[전체 사용자 가이드(중국어 간체)](../USAGE.md)** · [빠른 시작](#빠른-시작) · [포워딩 방식 선택](#포워딩-방식-선택)

## 주요 기능

- **여러 터널 관리:** 호스트별로 연결을 확인하고 규칙을 개별 또는 일괄 시작·중지할 수 있습니다.
- **서비스 작업을 버튼으로 저장:** 시작, 중지, 재시작, 상태, 로그 명령을 저장하고 연결된 포워딩에서 실행하세요. 내장 템플릿으로 설정을 시작할 수 있습니다.
- **필요할 때 확인하고 연결:** 상태 및 상태 점검 명령을 설정하고, 지원되는 비대화형 시작 작업에서는 서비스 시작과 포워딩 연결을 함께 실행하며 단계별 결과를 확인하세요.
- **내장 SSH 터미널:** 여러 대화형 터미널 탭을 사용하거나, 입력 또는 지속적인 포그라운드 실행이 필요한 명령을 전용 터미널에서 실행하세요.
- **익숙한 SSH 포워딩 방식:** 로컬 포워딩(L), 원격 포워딩(R), 동적 SOCKS5 포워딩(D)을 제공하며, 순서가 있는 다단계 ProxyJump를 지원합니다.
- **호스트 설정 재사용:** SSH 설정에서 후보를 찾거나 호스트를 직접 추가할 수 있습니다. 비밀번호, 개인 키, 시스템 SSH 에이전트로 인증합니다.
- **실행 상황 확인:** 연결 상태, 수신 경로, 트래픽, 활성 연결, 재연결 진행 상황, 필터링 가능한 이벤트 로그를 확인할 수 있습니다.
- **터널 계속 사용:** 트레이나 메뉴 막대에서 백그라운드로 실행하고 네트워크 오류 후 다시 연결합니다. 로그인 시 시작하거나 앱 시작 시 선택한 규칙을 자동 연결하도록 설정할 수도 있습니다.
- **설정 정리 및 공유:** 이름, 태그, 색상, 아이콘을 지정하고 호스트, 포워딩, 명시적으로 선택한 서비스 템플릿을 가져오거나 내보내세요.
- **8개 언어 인터페이스:** 중국어 간체·번체, 일본어, 한국어, 영어, 독일어, 프랑스어, 러시아어를 지원하며 네이티브 오류 메시지와 SSH 설정 진단도 번역되어 있습니다. 라이트·다크 모드와 테마 설정도 제공합니다.

## 다운로드 및 설치

[Releases 다운로드 페이지](https://github.com/KrisLee1/OriaTunnel/releases/tag/v0.1.0)에서 운영체제와 기기 아키텍처에 맞는 패키지를 선택하세요.

- **Windows:** `.exe` 설치 프로그램을 다운로드하고 설치 마법사의 안내를 따르세요.
- **macOS:** `.dmg`를 다운로드하여 연 다음 `OriaTunnel.app`을 **응용 프로그램** 폴더로 드래그하세요. `.zip`을 다운로드했다면 먼저 안에 있는 `.dmg`를 추출하세요.

| 플랫폼 | 다운로드 |
| --- | --- |
| Windows x64 | [OriaTunnel_0.1.0_x64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_x64-setup.exe) |
| Windows ARM64 | [OriaTunnel_0.1.0_arm64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_arm64-setup.exe) |
| macOS Apple Silicon | [OriaTunnel_0.1.0_aarch64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_aarch64.dmg) |
| macOS Intel | [OriaTunnel_0.1.0_x64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_x64.dmg) |

정보 창의 버전 업데이트에서 새 버전을 확인하고 다운로드 및 설치할 수 있습니다. 시작 시 확인은 끌 수 있습니다. 설치하면 SSH 연결이 끊어지므로 터미널 작업을 먼저 저장하세요. 처음 설치하거나 이전 개발 빌드를 사용 중이면 위 설치 프로그램을 사용하세요. [앱 업데이트(중국어)](../USAGE.md#应用更新)를 참고하세요.

설치 후 OriaTunnel을 실행하고 [빠른 시작](#빠른-시작)에 따라 SSH 호스트를 추가하고 포워딩을 만드세요. 일상적인 사용에는 Node.js, pnpm, Rust가 필요하지 않습니다.

## 빠른 시작

처음 설정할 때는 SSH 주소, 포트, 사용자 이름, 인증 방식과 대상 서비스의 주소 및 포트가 필요합니다. 모르는 정보는 관리자에게 확인하세요. SSH 명령을 먼저 배울 필요는 없습니다. 아래 예시는 서비스가 이미 실행 중이라고 가정합니다.

1. OriaTunnel을 열고 **호스트 추가**를 선택합니다. SSH 설정에서 발견한 호스트를 선택하거나 연결 정보를 직접 입력하세요. 호스트 탐색은 설정만 읽으며 자동으로 연결하지 않습니다.
2. **새 포워딩**을 선택하고 호스트와 L / R / D를 지정한 다음 수신 주소와 포트를 입력합니다. L / R에는 대상 주소와 포트도 필요합니다.
3. **저장 후 시작**을 선택하고 안내에 따라 인증합니다. 처음 연결할 때는 서버 지문을 확인하세요.
4. **수신 대기 중**이 될 때까지 기다린 후 브라우저나 서비스 클라이언트에서 포워딩 주소를 사용합니다. D는 먼저 클라이언트에 SOCKS5를 설정해야 합니다.

예를 들어 SSH 서버의 웹 앱에 접근하려면 **L**을 선택하고 수신 주소를 `127.0.0.1:13000`, 대상을 `127.0.0.1:3000`으로 설정합니다. 시작한 후 이 컴퓨터에서 `http://127.0.0.1:13000`을 여세요. 여기서 대상의 `127.0.0.1`은 **SSH 서버 자체**를 뜻합니다. 이 예시는 서버의 3000번 포트에서 웹 앱이 실행 중이라고 가정합니다.

**수신 대기 중**은 포워딩 입구가 준비되었다는 뜻입니다. 실제 서비스 사용 가능 여부는 대상 애플리케이션, 네트워크, 접근 권한에도 달려 있습니다. 필요하면 [상태 확인 및 문제 해결(중국어)](../USAGE.md#查看状态与排查问题)을 참고하세요.

설정 후에는 연결 맵이나 포워딩 목록에서 저장된 규칙을 시작하면 됩니다. 준비된 HTTP, HTTPS, VNC 연결은 서비스 열기를 사용하고, 데이터베이스는 해당 클라이언트로 접속하세요.

OriaTunnel 설정 파일이 있다면 포워딩 페이지에서 가져온 뒤 내용을 검토하고 자신의 인증 정보를 입력하여 시작하세요. 가져온 서비스 템플릿은 검토 후 실행을 활성화해야 합니다. [기존 설정 사용(중국어 간체)](../USAGE.md#使用现成配置)을 참고하세요.

원격 서비스를 조작하려면 서비스 페이지에서 템플릿을 만들거나 가져오고 명령과 경로를 확인한 뒤 포워딩에 연결하세요. 작업은 해당 포워딩의 서비스 메뉴에서 실행합니다. 저장하거나 연결하는 것만으로 명령이 실행되지는 않습니다. [서비스 템플릿(중국어 간체)](../USAGE.md#预设远程命令)을 참고하세요.

## 포워딩 방식 선택

| 방식 | 사용 상황 | 서비스 접근 방법 |
| --- | --- | --- |
| **L · 로컬 포워딩** | 이 컴퓨터에서 서버의 웹 앱, 데이터베이스, VNC 서비스에 접근 | 로컬 수신 포트에 연결하면 SSH를 통해 원격 서비스에 접근합니다 |
| **R · 원격 포워딩** | 서버에서 이 컴퓨터의 개발 서비스에 접근 | 서버의 수신 포트에 연결하면 SSH를 통해 로컬 서비스에 접근합니다 |
| **D · 동적 포워딩** | SSH 호스트를 통해 여러 내부 주소에 접근 | 브라우저나 다른 클라이언트가 로컬 SOCKS5 프록시를 사용하도록 설정합니다 |

공유 IP를 사용하고 SSH 포트가 하나만 할당된 서버에서도 해당 포트를 통해 여러 서비스에 접근할 수 있습니다. [공유 IP 예시(중국어)](../USAGE.md#场景四共享-ip只分配一个-ssh-端口)를 참고하세요.

## 화면 미리 보기

연결 맵, 포워딩, 서비스, 호스트, 로그, SSH 터미널의 라이트·다크 화면입니다. 독립된 예시 데이터를 사용하며 실제 서버나 인증 정보는 포함하지 않습니다.

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/connection-map-dark.png"><img src="../assets/screenshots/connection-map-light.png" alt="연결 맵"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/terminal-dark.png"><img src="../assets/screenshots/terminal-light.png" alt="SSH 터미널"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/forwards-dark.png"><img src="../assets/screenshots/forwards-light.png" alt="포워딩 목록"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/services-dark.png"><img src="../assets/screenshots/services-light.png" alt="서비스"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/hosts-dark.png"><img src="../assets/screenshots/hosts-light.png" alt="SSH 호스트"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/logs-dark.png"><img src="../assets/screenshots/logs-light.png" alt="로그"></picture> |

## 사용자 문서

[전체 사용자 가이드(중국어 간체)](../USAGE.md)에서 호스트 관리, 인증, 포워딩 사용 예시, 백그라운드 실행, 자주 발생하는 문제를 설명합니다..

- [첫 연결과 일상적인 사용](../USAGE.md#第一次连接远程服务)
- [기존 설정 사용](../USAGE.md#使用现成配置)
- [서비스 템플릿과 작업](../USAGE.md#预设远程命令)
- [상태 점검 및 서비스 시작 후 연결](../USAGE.md#服务状态健康检查与启动并连接)
- [SSH 대화형 터미널](../USAGE.md#ssh-交互终端)
- [SSH 호스트 추가 및 관리(중국어)](../USAGE.md#添加和管理-ssh-主机)
- [포워딩 생성 및 관리(중국어)](../USAGE.md#创建和管理转发)
- [L: 원격 서비스에 접근(중국어)](../USAGE.md#场景一访问服务器上的网页或数据库l) · [R: 로컬 서비스에 접근(중국어)](../USAGE.md#场景二让服务器访问本机开发服务r) · [D: SOCKS5 프록시(중국어)](../USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [설정 가져오기 및 내보내기(중국어)](../USAGE.md#配置导入与导出)
- [백그라운드 실행, 재연결, 자동 시작(중국어)](../USAGE.md#后台运行重连与自动启动)
- [상태 확인 및 문제 해결(중국어)](../USAGE.md#查看状态与排查问题)

## 버전 기록

### v0.1.0 · 첫 버전 · 2026-10-25

- 시각적인 SSH 호스트 및 L / R / D 터널 관리, 다단계 인증, 연결 진단.
- 재사용 가능한 서비스 템플릿, 명령 작업, 상태 점검, 서비스 시작과 포워딩 연결의 결합.
- 다중 탭 SSH 터미널과 대화형·포그라운드 명령용 전용 터미널.
- 설정 가져오기·내보내기, 트레이 및 메뉴 막대 실행, 터널 재연결, 8개 인터페이스 언어와 테마 설정.

## 알아둘 사항

L / R / D는 TCP 트래픽을 포워딩합니다. D는 루프백 주소에서만 수신하며 SOCKS5 CONNECT를 지원합니다. UDP는 지원하지 않고 시스템이나 브라우저의 프록시 설정도 자동으로 변경하지 않습니다. 다른 컴퓨터에서 R에 접근할 수 있는지는 서버의 SSH 정책, 방화벽, 네트워크 설정에 달려 있습니다.

기본적으로 창을 닫아도 포워딩은 트레이나 메뉴 막대에서 계속 실행됩니다. **OriaTunnel 종료**를 선택하면 모든 연결이 중지됩니다. 자동 연결은 별도로 켜야 하는 선택 설정입니다. 모든 경유 호스트가 신뢰된 상태이고 개인 키 또는 SSH 에이전트로 인증할 수 있어야 하며, 저장된 비밀번호는 사용하지 않습니다.

Windows와 macOS에서는 원할 때 비밀번호를 시스템 자격 증명 저장소에 저장할 수 있습니다. 내보내기에는 저장된 인증 비밀번호, 개인 키 내용, 신뢰 기록이 포함되지 않습니다. 호스트 주소, 사용자 이름, 포트와 함께 서비스를 선택한 경우 스크립트와 환경 변수도 포함되므로 공유 전에 내용을 확인하세요. 자세한 내용은 [기능 범위(중국어)](../USAGE.md#当前功能边界)를 참고하세요.

서비스 템플릿은 서버의 소프트웨어, 경로, 권한에 맞게 설정해야 하며 앱을 설치하거나 배포하지 않습니다. 포워딩 시작과 중지는 터널을 제어하고, 원격 서비스 작업은 별도로 실행합니다. 점검은 필요할 때 수행하며 백그라운드 상시 모니터링은 제공하지 않습니다.

개발을 계속하려면 [개발 가이드(중국어 간체)](../DEVELOPMENT.md)를 참고하세요.

문제가 있으면 [문제 해결 가이드(중국어 간체)](../USAGE.md#查看状态与排查问题)를 확인하고 [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues)에 재현 단계와 민감 정보를 제거한 내용을 남겨 주세요.
