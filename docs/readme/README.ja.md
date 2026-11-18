<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<h1 align="center">SSH でのリモート管理をひとつのワークスペースに</h1>

<p align="center">OriaTunnel は、SSH トンネル、リモートサービス、ターミナル、ファイル転送、リモートデスクトップを同じ画面から扱えるツールです。</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a> · 日本語 · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

**[ダウンロードとインストール](#ダウンロードとインストール)** · [クイックスタート](#クイックスタート) · [詳しいユーザーガイド（中国語・簡体字）](../USAGE.md) · [オンラインデモ（簡体字中国語）](https://oriamade.com/zh-CN/oria-tunnel#workspace)

## できること

### 🔗 接続図でトンネルを管理

- ローカルポートと SSH ホストのつながりを接続図で確認できます。転送ルールを個別または一括で開始・停止し、接続状態、接続数、通信量を確認できます。
- 既存の SSH 設定からホストを選ぶか、手動で追加します。パスワード、秘密鍵、システムの SSH エージェントによる認証と、複数の踏み台を経由する接続（ProxyJump）に対応しています。
- よく使うルールを保存すれば、接続図から社内の Web サイトを開いたり、手元のデータベースクライアントから転送ポートに接続したりできます。

### ⚙️ リモートサービスの操作

- 起動・停止・再起動、状態やログの確認に使うコマンドをテンプレートに保存できます。転送に関連付けると、サービスメニューから実行できます。
- 先にサービスを起動する必要がある場合は、起動コマンドとヘルスチェックを設定します。起動からトンネル接続まで、各段階の結果を確認できます。

### 💻 ローカルと SSH のターミナル

- ローカルとリモートのセッションをタブで切り替えます。入力候補を利用したり、↑ で履歴を開いたり、別のセッションで保存したコマンドをキーワードで呼び出したりできます。
- Shift+Enter で複数行を編集できます。ディレクトリを移動しても入力途中のコマンドは保持されます。長い出力を折りたたみ、コマンドだけ、またはその結果だけをコピーできます。

### 📁 ファイル転送

- ローカルとリモートのディレクトリを並べ、ドラッグ＆ドロップで複数のファイルを送受信できます。左右に別々の SSH ホストを開けば、ホスト間でも転送できます。
- バックグラウンドキューで進捗を確認し、一時停止、再開、キャンセルを行えます。ファイルのプレビューやテキストの編集も可能です。

### 🖥️ VNC リモートデスクトップ

- VNC 転送から専用ウィンドウを開き、SSH トンネル経由でデスクトップを操作できます。全画面表示、拡大縮小、双方向のテキストコピーに対応しています。
- 同じウィンドウから SSH ターミナルを開いたり、SFTP でファイルを転送したりできます。ウィンドウを閉じた後も、登録済みの転送は続行されます。

## ダウンロードとインストール

| OS | インストーラー v0.4.1 | インストール方法 |
| --- | --- | --- |
| macOS | [Apple Silicon](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.1/OriaTunnel_0.4.1_aarch64.dmg) · [Intel](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.1/OriaTunnel_0.4.1_x64.dmg) | ディスクイメージを開き、OriaTunnel を「アプリケーション」にドラッグします。 |
| Windows | [x64](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.1/OriaTunnel_0.4.1_x64-setup.exe) · [ARM64](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.4.1/OriaTunnel_0.4.1_arm64-setup.exe) | インストーラーを実行し、画面の案内に従います。 |

### 更新履歴

**v0.4.1** · ドラッグ＆ドロップでターミナルを分割表示できるようになりました。サイズ変更が滑らかになり、大量のファイル転送の再開も高速化しました。「このアプリについて」から更新を確認できます。

[リリースノート（簡体字中国語）](../releases/v0.4.1.md) · [すべてのバージョン](https://github.com/KrisLee1/OriaTunnel/releases)

## クイックスタート

SSH サーバーのポート 3000 で動作している Web サービスを、手元のブラウザーで開く例です。

1. OriaTunnel を開き、**「ホストを追加」**を選択します。SSH 設定から検出したホストを選ぶか、接続情報を手動で入力します。検出は設定を読み取るだけで、自動的に接続することはありません。
2. 「新しい転送」でホストとローカル転送（L）を選びます。ローカルの待ち受け先を `127.0.0.1:13000`、接続先を SSH サーバー上の `127.0.0.1:3000` に設定します。
3. **「保存して開始」**を選択し、表示される案内に従って認証します。初回の接続ではサーバーのフィンガープリントを確認してください。 「待ち受け中」と表示されたら、手元のブラウザーで `http://127.0.0.1:13000` を開きます。

次回からは保存したルールを開始するだけです。ページが開かない場合は、接続先のポートでサービスが動作しているか確認してください。 [トラブルシューティング（簡体字中国語）](../USAGE.md#查看状态与排查问题)

### 転送方式を選ぶ

| 方式 | 用途 | サービスへのアクセス方法 |
| --- | --- | --- |
| **L · ローカル転送** | このコンピュータからサーバー上の Web アプリ、データベース、VNC にアクセスする | ローカルの待ち受けポートに接続すると、SSH 経由でリモートのサービスに届きます |
| **R · リモート転送** | このコンピュータで動く開発用サービスに、サーバーからアクセスする | サーバー上の待ち受けポートに接続すると、SSH 経由でローカルのサービスに届きます |
| **D · 動的転送** | SSH ホストを経由して複数の内部アドレスにアクセスする | メニューから独立したプロキシブラウザーを開くか、別のクライアントに SOCKS5 を設定します |

OriaTunnel の設定ファイルがある場合は、転送ページから読み込み、内容を確認して自分の認証情報を設定してから開始します。読み込んだサービステンプレートは確認後に実行を有効にする必要があります。[既存の設定を使う（簡体字中国語）](../USAGE.md#使用现成配置)を参照してください。

## スクリーンショット

OriaMadeWeb の OriaTunnel デモのサンプルデータを使った画面です。表示テーマに合わせてライト・ダークが切り替わります。

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/connection-map-dark.png"><img src="../assets/screenshots/connection-map-light.png" alt="接続マップ"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/terminal-dark.png"><img src="../assets/screenshots/terminal-light.png" alt="ターミナルのコマンドライブラリ"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/files-dark.png"><img src="../assets/screenshots/files-light.png" alt="ファイル転送キュー"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vnc-dark.png"><img src="../assets/screenshots/vnc-light.png" alt="VNC リモートデスクトップ"></picture> |

<details>
<summary>その他の画面</summary>

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/forwards-dark.png"><img src="../assets/screenshots/forwards-light.png" alt="転送ルール"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/services-dark.png"><img src="../assets/screenshots/services-light.png" alt="サービス"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/hosts-dark.png"><img src="../assets/screenshots/hosts-light.png" alt="SSH ホスト"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/logs-dark.png"><img src="../assets/screenshots/logs-light.png" alt="アクティビティログ"></picture> |

</details>

## ドキュメントとサポート

[詳しいユーザーガイド（中国語・簡体字）](../USAGE.md) · [トラブルシューティング（簡体字中国語）](../USAGE.md#查看状态与排查问题) · [開発ガイド（中国語・簡体字）](../DEVELOPMENT.md) · [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues)

## ライセンス

Copyright (C) 2026 KrisLee.

OriaTunnel は **GNU General Public License 第 3 版のみ（GPL-3.0-only）**で提供されます。全文は [LICENSE](../../LICENSE) を参照してください。

本ソフトウェアは無保証で提供されます。詳細はライセンスを参照してください。サードパーティのコード、依存関係、素材にはそれぞれのライセンスと表示が適用されます。同梱する第三者のライセンスは [docs/licenses](../licenses) にあります。
