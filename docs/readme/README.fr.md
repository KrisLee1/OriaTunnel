<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">Gérez vos tunnels SSH visuellement et utilisez vos services distants simplement.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · Français · <a href="README.ru.md">Русский</a>
</p>

OriaTunnel est un outil de bureau de gestion des tunnels SSH et des services distants pour Windows et macOS. Gérez plusieurs serveurs, tunnels et services depuis une interface visuelle, sans mémoriser de commandes de redirection complexes. Accédez aux bases de données, interfaces web et environnements de développement de votre réseau interne et lancez des actions de service préconfigurées.

Enregistrez vos hôtes et règles de redirection, puis démarrez, arrêtez et ouvrez vos services depuis l’interface. Sans connaître les commandes SSH, vous pouvez aussi importer une configuration préparée par un administrateur ou un collègue et renseigner vos propres informations d’authentification.

Version actuelle : **v0.1.1** · [Historique des versions](#historique-des-versions)

**[Guide utilisateur complet (chinois simplifié)](../USAGE.md)** · [Prise en main](#prise-en-main) · [Choisir un mode de redirection](#choisir-un-mode-de-redirection)

## Fonctionnalités

- **Gérer plusieurs tunnels :** affichez les connexions par hôte et démarrez ou arrêtez les règles individuellement ou par lot.
- **Transformer les commandes de service en boutons :** enregistrez les actions de démarrage, d’arrêt, de redémarrage, d’état et de journaux, puis lancez-les depuis une redirection associée. Des modèles intégrés facilitent la configuration.
- **Vérifier et connecter les services :** configurez des sondes d’état et de santé, ou combinez un démarrage non interactif pris en charge avec la connexion de la redirection, en consultant chaque résultat.
- **Ouvrir un terminal SSH :** utilisez plusieurs onglets interactifs ou un terminal dédié aux commandes interactives et aux services fonctionnant au premier plan.
- **Utiliser les modes de redirection SSH habituels :** redirection locale (L), redirection distante (R) et redirection SOCKS5 dynamique (D), avec prise en charge de routes ProxyJump ordonnées à plusieurs relais.
- **Réutiliser les réglages des hôtes :** détectez les hôtes disponibles dans la configuration SSH ou ajoutez-les manuellement ; authentifiez-vous avec un mot de passe, une clé privée ou l’agent SSH du système.
- **Suivre le fonctionnement :** consultez l’état des connexions, les adresses et ports d’écoute, le trafic, les connexions actives, la progression des reconnexions et les journaux d’événements filtrables.
- **Garder les tunnels disponibles :** fonctionnement dans la zone de notification ou la barre des menus, reconnexion après une panne réseau et, en option, lancement à l’ouverture de session ou connexion des règles choisies au démarrage de l’application.
- **Organiser et partager les configurations :** personnalisez les noms, étiquettes, couleurs et icônes ; importez ou exportez les hôtes, redirections et modèles de service explicitement sélectionnés.
- **Choisir parmi huit langues d’interface :** chinois simplifié, chinois traditionnel, japonais, coréen, anglais, allemand, français et russe, y compris pour les messages d’erreur natifs et les diagnostics de configuration SSH. Des réglages d’apparence claire, sombre et de thème sont disponibles.

## Télécharger et installer

Consultez la [page de téléchargement Releases](https://github.com/KrisLee1/OriaTunnel/releases/tag/v0.1.1) et choisissez le paquet adapté à votre système d’exploitation et à l’architecture de votre appareil.

- **Windows :** téléchargez le programme d’installation `.exe` et suivez l’assistant d’installation.
- **macOS :** téléchargez et ouvrez le fichier `.dmg`, puis glissez `OriaTunnel.app` dans **Applications**. Si vous téléchargez un fichier `.zip`, extrayez d’abord le fichier `.dmg` qu’il contient.

| Plateforme | Téléchargement |
| --- | --- |
| Windows x64 | [OriaTunnel_0.1.1_x64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_x64-setup.exe) |
| Windows ARM64 | [OriaTunnel_0.1.1_arm64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_arm64-setup.exe) |
| macOS Apple Silicon | [OriaTunnel_0.1.1_aarch64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_aarch64.dmg) |
| macOS Intel | [OriaTunnel_0.1.1_x64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_x64.dmg) |

Vérifiez les mises à jour dans **À propos → Mise à jour**, puis téléchargez et installez la nouvelle version. La vérification au démarrage peut être désactivée. L’installation interrompt les connexions SSH ; enregistrez d’abord votre travail dans le terminal. Pour une première installation ou une ancienne version de développement, utilisez les programmes ci-dessus. Voir les [mises à jour de l’application (chinois)](../USAGE.md#应用更新).

Lancez OriaTunnel après l’installation, puis suivez la [prise en main](#prise-en-main) pour ajouter un hôte SSH et créer une redirection. L’utilisation quotidienne ne nécessite ni Node.js, ni pnpm, ni Rust.

## Prise en main

Pour la première configuration, préparez l’adresse SSH, le port, le nom d’utilisateur, l’authentification ainsi que l’adresse et le port du service cible. Demandez ces informations à votre administrateur si nécessaire ; il n’est pas nécessaire d’apprendre les commandes SSH. Cet exemple suppose que le service fonctionne déjà.

1. Ouvrez OriaTunnel et choisissez **Ajouter un hôte**. Sélectionnez un hôte détecté dans la configuration SSH ou saisissez ses informations manuellement. La détection lit uniquement la configuration ; elle ne se connecte pas automatiquement.
2. Choisissez **Nouvelle redirection**, sélectionnez l’hôte et L / R / D, puis renseignez l’adresse et le port d’écoute. L / R nécessitent aussi une adresse et un port cibles.
3. Choisissez **Enregistrer et démarrer**, authentifiez-vous lorsque l’application le demande et vérifiez l’empreinte du serveur lors de la première connexion.
4. Attendez l’état **En écoute**, puis utilisez le point d’accès de la redirection dans votre navigateur ou votre client. Pour D, utilisez le menu du navigateur proxy ; les services associés peuvent être ouverts directement.

Par exemple, pour accéder à une application web sur votre serveur SSH, choisissez **L**, écoutez sur `127.0.0.1:13000` et définissez `127.0.0.1:3000` comme cible. Une fois la redirection démarrée, ouvrez `http://127.0.0.1:13000` sur cet ordinateur. L’adresse cible `127.0.0.1` désigne **le serveur SSH lui-même** ; cet exemple suppose que l’application web y fonctionne sur le port 3000.

L’état **En écoute** signifie que le point d’accès de la redirection est prêt. La disponibilité du service dépend aussi de l’application cible, du réseau et des autorisations. Au besoin, consultez la rubrique [État et dépannage (chinois)](../USAGE.md#查看状态与排查问题).

Une fois la configuration enregistrée, démarrez la règle depuis la carte ou la liste. Les accès HTTP, HTTPS ou VNC prêts peuvent être ouverts par le bouton du service ; les bases de données utilisent leur client habituel.

Vous disposez déjà d’un fichier OriaTunnel ? Importez-le depuis la page des redirections, vérifiez son contenu et complétez votre authentification avant de démarrer. Les modèles de service importés nécessitent une vérification et une activation explicites. Voir [utiliser une configuration existante (chinois)](../USAGE.md#使用现成配置).

Pour agir sur un service distant, créez ou importez un modèle sur la page des services, vérifiez les commandes et chemins, puis associez-le dans l’éditeur de redirection. Lancez les actions depuis le menu de cette redirection. Enregistrer ou associer un modèle n’exécute aucune commande. Voir [modèles de service (chinois)](../USAGE.md#预设远程命令).

## Choisir un mode de redirection

| Mode | Cas d’utilisation | Accès au service |
| --- | --- | --- |
| **L · Redirection locale** | Accéder depuis cet ordinateur à une application web, une base de données ou un service VNC du serveur | Se connecter à un port d’écoute local qui mène au service distant via SSH |
| **R · Redirection distante** | Permettre à un serveur d’accéder à un service de développement exécuté sur cet ordinateur | Se connecter à un port d’écoute sur le serveur qui mène au service local via SSH |
| **D · Redirection dynamique** | Atteindre plusieurs adresses internes via un hôte SSH | Ouvrir un navigateur proxy distinct depuis le menu, ou configurer un autre client pour SOCKS5 local |

Un serveur avec une adresse IP partagée et un seul port SSH attribué peut tout de même donner accès à plusieurs services via ce port. Consultez l’[exemple d’adresse IP partagée (chinois)](../USAGE.md#场景四共享-ip只分配一个-ssh-端口).

## Captures d’écran

Vues claires et sombres de la carte, des redirections, services, hôtes, journaux et du terminal SSH. Les images utilisent des données d’exemple isolées, sans serveurs réels ni identifiants.

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/connection-map-dark.png"><img src="../assets/screenshots/connection-map-light.png" alt="Carte des connexions"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/terminal-dark.png"><img src="../assets/screenshots/terminal-light.png" alt="Terminal SSH"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/forwards-dark.png"><img src="../assets/screenshots/forwards-light.png" alt="Redirections"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/services-dark.png"><img src="../assets/screenshots/services-light.png" alt="Services"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/hosts-dark.png"><img src="../assets/screenshots/hosts-light.png" alt="Hôtes SSH"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/logs-dark.png"><img src="../assets/screenshots/logs-light.png" alt="Journaux"></picture> |

## Documentation utilisateur

Le [guide utilisateur complet (chinois simplifié)](../USAGE.md) présente la gestion des hôtes, l’authentification, des exemples détaillés de redirection, le fonctionnement en arrière-plan et les problèmes courants .

- [Première connexion et utilisation quotidienne](../USAGE.md#第一次连接远程服务)
- [Utiliser une configuration existante](../USAGE.md#使用现成配置)
- [Modèles et actions de service](../USAGE.md#预设远程命令)
- [Vérifications d’état et de santé, démarrage et connexion](../USAGE.md#服务状态健康检查与启动并连接)
- [Terminal SSH interactif](../USAGE.md#ssh-交互终端)
- [Ajouter et gérer les hôtes SSH (chinois)](../USAGE.md#添加和管理-ssh-主机)
- [Créer et gérer les redirections (chinois)](../USAGE.md#创建和管理转发)
- [L : accéder aux services distants (chinois)](../USAGE.md#场景一访问服务器上的网页或数据库l) · [R : accéder aux services locaux (chinois)](../USAGE.md#场景二让服务器访问本机开发服务r) · [D : proxy SOCKS5 (chinois)](../USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [Importer et exporter les configurations (chinois)](../USAGE.md#配置导入与导出)
- [Arrière-plan, reconnexions et démarrage (chinois)](../USAGE.md#后台运行重连与自动启动)
- [État et dépannage (chinois)](../USAGE.md#查看状态与排查问题)

## Historique des versions

### v0.1.1 · 2026-10-27

- Ajout d’actions aux transferts D pour ouvrir un navigateur proxy et accéder directement aux services distants.
- Amélioration des associations et de la gestion des services, ainsi que de l’accès aux services distants.
- Amélioration des performances de rendu de la carte des connexions et correction de l’affichage des cartes.

### v0.1.0 · Première version · 2026-10-25

- Gestion visuelle des hôtes SSH et des tunnels L / R / D, authentification à plusieurs relais et diagnostic des connexions.
- Modèles réutilisables, commandes de service, vérifications d’état et de santé, démarrage du service avec connexion de la redirection.
- Terminaux SSH à plusieurs onglets et terminaux dédiés aux commandes interactives ou au premier plan.
- Import et export, fonctionnement dans la zone de notification ou la barre des menus, reconnexion des tunnels, huit langues et thèmes.

## À savoir

L / R / D redirigent le trafic TCP. D écoute uniquement sur des adresses de boucle locale et prend en charge SOCKS5 CONNECT sans UDP. Il peut ouvrir des fenêtres proxy Chrome, Edge ou Firefox distinctes sans modifier le proxy système ni les réglages habituels du navigateur. Safari n’est pas pris en charge. L’accès à R depuis d’autres ordinateurs dépend de la politique SSH du serveur, du pare-feu et de la configuration réseau.

Par défaut, la fermeture de la fenêtre laisse les redirections fonctionner dans la zone de notification ou la barre des menus. **Quitter OriaTunnel** arrête toutes les connexions. La connexion automatique est un réglage distinct à activer explicitement ; elle nécessite des hôtes approuvés à chaque relais et une authentification par clé privée ou agent, et n’utilise pas les mots de passe enregistrés.

Sous Windows et macOS, vous pouvez choisir d’enregistrer les mots de passe dans le gestionnaire d’identifiants du système. Les exports n’incluent pas les mots de passe d’authentification enregistrés, le contenu des clés privées ni les enregistrements d’approbation. Ils incluent les adresses, noms d’utilisateur et ports, ainsi que les scripts et variables d’environnement si des services sont sélectionnés. Vérifiez le contenu avant de le partager. Consultez les [limites fonctionnelles (chinois)](../USAGE.md#当前功能边界) pour plus de détails.

Les modèles doivent correspondre aux logiciels, chemins et permissions du serveur ; ils n’installent ni ne déploient les applications. Le démarrage ou l’arrêt d’une redirection contrôle le tunnel. Les actions de service sont distinctes. Les vérifications sont exécutées à la demande, sans surveillance continue en arrière-plan.

Pour le développement, consultez le [guide de développement (chinois simplifié)](../DEVELOPMENT.md).

En cas de problème, consultez le [guide de dépannage (chinois)](../USAGE.md#查看状态与排查问题) ou signalez les étapes et informations expurgées dans [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues).

## Licence

Copyright (C) 2026 KrisLee.

OriaTunnel est distribué sous la **GNU General Public License, version 3 uniquement (GPL-3.0-only)**. Le texte intégral figure dans [LICENSE](../../LICENSE).

Ce logiciel est fourni sans aucune garantie, conformément à la licence. Le code, les dépendances et les ressources de tiers conservent leurs licences et mentions respectives. Les textes de licences tiers inclus sont disponibles dans [docs/licenses](../licenses).
