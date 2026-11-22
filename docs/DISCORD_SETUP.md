# Intégration Discord — Bro Client

Cette intégration se compose de deux parties :

1. Connexion au site via Discord OAuth (Supabase Auth, PKCE et cookies HttpOnly).
2. Bot Discord pour les rôles Clients validés après achat Whop, via les interactions HTTPS. **Le bot ne nécessite pas de connexion Gateway persistante** ; sa présence peut paraître hors ligne dans la liste des membres.

## 1. Discord Developer Portal

Dans l'application Discord **Bro Client** :

- **OAuth2 > Redirects** : `https://izzqsgszyvkibmkdruvj.supabase.co/auth/v1/callback` (redirection vers Supabase, pas vers le site).
- **Bot** : créer le bot puis générer/copier son token. Ne jamais envoyer ce token dans un message ou le placer dans le code.
- **Installation** : activer `Guild Install`, scopes `bot` et `applications.commands`, permission **Manage Roles** uniquement (bitfield `268435456`).
- Installer l'application sur le serveur depuis le lien Guild Install avec un compte possédant **Gérer le serveur**.
- Placer le rôle du bot **au-dessus** des rôles `Customer` et `Lifetime` dans les réglages des rôles Discord.
- Dans **General Information**, récupérer `Application ID` et `Public Key`.
- Dans les paramètres des interactions, indiquer `https://www.broclient.com/api/discord/interactions` seulement *après* avoir ajouté la clé publique dans Vercel et redéployé le site.

## 2. Vercel — projet `bro`

Ajouter ces variables dans **Production** :

| Variable | Provenance |
|---|---|
| `BRO_DISCORD_SUPABASE_PUBLISHABLE_KEY` | Supabase > API Keys : clé publique du projet `izzqsgszyvkibmkdruvj` (déjà ajoutée) |
| `BRO_DISCORD_BOT_TOKEN` | Discord > Bot > Token ; **Sensitive** |
| `BRO_DISCORD_APPLICATION_ID` | Discord > General Information > Application ID |
| `BRO_DISCORD_PUBLIC_KEY` | Discord > General Information > Public Key (hex) |
| `BRO_DISCORD_GUILD_ID` | Serveur Bro Client : `1448897452404117558` |
| `BRO_DISCORD_CUSTOMER_ROLE_ID` | Rôle Customer : `1574096039663898766` |
| `BRO_DISCORD_LIFETIME_ROLE_ID` | Rôle Lifetime : `1574096085197131957` |
| `CRON_SECRET` | Long secret aléatoire ; **Sensitive**, protège le nettoyage des rôles expirés |

Après l'ajout des variables : effectuer un **nouveau déploiement Production**. Le cron de l'application s'exécute toutes les heures pour retirer le rôle des clients dont les passes Jour, Semaine ou Mois sont expirés. Le pass Lifetime n'expire pas.

## 3. Supabase

Dans **Authentication > Providers > Discord**, renseigner le Client ID et Client Secret de l'application Discord. Le Client Secret Discord est distinct du Bot Token.

Dans **URL Configuration**, définir :

- Site URL : `https://www.broclient.com`
- Redirect URL autorisée : `https://www.broclient.com/connexion.html`

## 4. Whop — prérequis pour une attribution de rôle liée à un paiement

Le bot ne donne jamais un rôle sur simple déclaration de l'utilisateur. Le paiement doit être confirmé par le webhook signé Whop. Renseigner les variables existantes `WHOP_API_KEY`, `WHOP_ACCOUNT_ID` et `WHOP_WEBHOOK_SECRET` dans Vercel Production et configurer dans Whop le webhook `https://www.broclient.com/api/whop/webhook`.

Une fois Whop + le bot configurés :

- L'utilisateur doit être connecté à Bro Client avec Discord **avant** de commencer un checkout.
- Le paiement signé enregistre la facture et la durée du pass (Jour 24 h, Semaine 7 jours, Mois 30 jours, Lifetime permanent).
- Les pass Jour, Semaine et Mois donnent le rôle **Customer**.
- Le pass Lifetime donne **Customer** ET **Lifetime**.
- Les rôles sont attribués uniquement au compte Discord associé au paiement confirmé et présent sur le serveur.
- Les achats effectués comme invité **ne sont pas liés** au compte Discord et ne déclenchent donc pas de rôle automatiquement.

## 5. Activation des commandes

Depuis l'espace client d'un compte administrateur reconnu, cliquer sur **Installer les commandes /bro**. Cela enregistre dans le serveur :

- `/bro statut` : vérifier la configuration du bot.
- `/bro acces` : synchroniser son rôle Client à partir des achats confirmés.

L'endpoint Discord vérifie systématiquement les signatures Ed25519 avant toute action. Les endpoints du site contrôlent la session Supabase, les permissions et les informations de paiement. Aucune clé secrète ne doit figurer dans le navigateur ou dans le dépôt.

## 6. Vérifications avant utilisation réelle

1. Ouvrir `https://www.broclient.com/connexion.html` et compléter la connexion Discord.
2. Vérifier le retour sur l'espace client et la persistance de la session.
3. Faire installer le bot depuis **Guild Install**, vérifier le rôle et la hiérarchie.
4. Vérifier dans Discord que l'Interactions Endpoint URL est accepté.
5. Enregistrer les commandes depuis l'administration Bro Client.
6. Effectuer un paiement de test **réellement confirmé** dans Whop avec un compte de test, puis vérifier l'attribution du rôle.
7. Vérifier qu'un compte sans achat ne peut pas obtenir le rôle.
8. Vérifier qu'un rôle est retiré après expiration du pass et non pour un Lifetime.

**Limites :** sans jeton de bot, autorisation Guild Install, rôle cible, et intégration Whop configurée, les rôles ne peuvent pas être synchronisés. Il n'est pas possible d'installer une application sur un serveur tiers sans l'autorisation d'un administrateur du serveur.

## 7. Tarifs officiels 22 novembre 2026

| Pass | Prix de vente affiché |
|---|---:|
| Jour | 6 € |
| Semaine | 15 € |
| Mois | 35 € |
| Lifetime | 100 € |

Chaque lien de checkout doit correspondre au bon produit Whop, à un plan **one_time**, à la devise EUR et au prix ci-dessus. Les prix du site ne vérifient pas à eux seuls le montant final facturé par Whop ; une vérification indépendante de chacun des quatre checkouts dans Whop est nécessaire. Sans accès authentifié à Whop ou API marchand, on ne peut pas confirmer cette partie.
