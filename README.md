# Bot Yakkamon — Ronin Launchpad

Bot local TypeScript/viem, sans navigateur à l'exécution. Cible par défaut : **OG Trainers, 15 septembre 2026 à 02:00 Europe/Paris (00:00 UTC)**. Un mint gratuit de un NFT maximum, avec l'adresse éligible.

**État : implémenté et testé sur un fork local ; exécution mainnet désactivée.** L'adresse et la clé privées de l'utilisateur n'ont pas été utilisées pendant le développement. Le contrôle de son éligibilité et de son solde reste à faire. L'observation de la vague 1 sera possible à partir du 14 septembre.

## Configuration locale

Node.js 22+, pnpm 11.22.0. Depuis ce dossier :

```powershell
pnpm install --frozen-lockfile
pnpm setup:env
```

Le fichier `.env` a déjà été créé. `setup:env` conserve les valeurs existantes et ne remplace jamais la clé. Le fichier est exclu de Git, comme `runtime/` qui contient les transactions signées.

Renseigner localement :

```dotenv
RONIN_PRIVATE_KEY=
EXPECTED_WALLET=
MAX_TOTAL_GAS_RON=
```

- `RONIN_PRIVATE_KEY` : clé du wallet éligible, avec ou sans `0x`. Ne pas la coller dans une conversation. Elle ne sera lue par le signataire que dans `run` activé.
- `EXPECTED_WALLET` : adresse publique de ce même wallet, `0x…` ou `ronin:…`. Cette valeur indépendante permet de détecter une mauvaise clé. Elle suffit pour les commandes en lecture seule.
- `MAX_TOTAL_GAS_RON` : budget maximum d'admission, exprimé en **RON**, pas en dollars. Il reste volontairement vide jusqu'au choix de l'utilisateur. Voir la limite des frais L1 ci-dessous.

Les contrats sont préremplis et vérifiés. `STAGE_INDEX=2` sélectionne OG. `FEE_MODE=race` utilise des fees récentes avec plafonds : priorité 200 Gwei, maxFee 500 Gwei. Ces plafonds ne sont pas des dépenses fixes. `ENABLE_MAINNET_MINT=false` empêche toute signature et diffusion par défaut.

Ces plafonds sont ceux du modèle. Le profil local demandé le 12 septembre autorise désormais **100 RON** de budget, une priorité maximale de **250 000 Gwei** et un maxFee de **300 000 Gwei**. `RACE_MIN_PRIORITY_FEE_GWEI=10000` fixe une priorité de départ plus élevée même lorsque l'historique est calme. La priorité retenue est le maximum de ce plancher et du double des récompenses observées au 90e percentile, dans les plafonds configurés. Le plancher ne s'applique pas aux modes normal/aggressive. Le budget et le solde sont toujours contrôlés avant signature ; un solde inférieur à 100 RON ne permet pas de dépenser 100 RON. Les frais d'une transaction déjà diffusée ne sont pas augmentés automatiquement (RBF désactivé).

Au cours indicatif consulté de 0,05036 USD/RON, 100 RON représentent environ 5,04 USD. Ce n'est pas un plafond en dollars indexé sur le marché. Avec le gas du test local, le plancher de priorité de 10 000 Gwei représenterait environ 2,83 RON d'exécution, avant frais L1 ; il peut augmenter si les fees observées augmentent.

`RONIN_RPC_URLS` accepte une liste de 1 à 5 URL HTTPS séparées par des virgules. Les erreurs affichées ne contiennent pas les URL, qui peuvent intégrer des clés fournisseur. La configuration contient le RPC officiel et le RPC public thirdweb `https://2020.rpc.thirdweb.com`, testé sans compte ni clé API le 12 septembre 2026 : réseau 2020, blocs récents et hash identique au RPC officiel, contrats et précontrôle OG validés. Les endpoints publics restent soumis à disponibilité et limitations de débit. Voir `research/RPC-VALIDATION.md`.

## Commandes en lecture seule

```powershell
pnpm bot status
pnpm bot preflight
pnpm bot run --dry-run
pnpm bot observe --once
pnpm bot observe
pnpm bot decode 0xHASH_TRANSACTION
```

`status` vérifie le réseau, les empreintes des contrats, l'implémentation du proxy et les phases ; si `EXPECTED_WALLET` est présent, il vérifie les cinq whitelists et les quotas du wallet. Il n'a pas besoin de la clé privée.

`preflight` et `run --dry-run` ne signent ni ne diffusent rien, même si une clé est présente et que l'exécution mainnet est activée. Ils vérifient prix individuel, éligibilité, pauses, stock global et de phase, limite, solde, nonce pending, calldata et fees. Avant l'ouverture, `not-started` est normal : les autres validations restent nécessaires. `readyForExecution=false` avant cette heure ne signifie pas que la whitelist est invalide.

Le RPC officiel refuse actuellement `eth_simulateV1` (`hypothetical: unsupported`). Le RPC thirdweb a accepté cette simulation à l'heure d'ouverture pour le wallet configuré, avec 282 605 gas. Cela reste une simulation hypothétique. À l'ouverture, le bot exige une simulation `eth_call` réussie dans l'état pending réel et un `eth_estimateGas` réussi. Le test local a aussi validé le chemin complet avec un timestamp avancé, sans modifier la whitelist.

`observe` reste au premier plan jusqu'à Ctrl+C. Il attend des événements `MintSuccess`, enregistre les mints Yakkamon dans `runtime/observed-mints.jsonl`, puis reprend depuis un curseur local. Il utilise deux blocs de recul et relit une petite zone au redémarrage ; dédupliquer les résultats par hash si nécessaire. Ce n'est pas une garantie contre une réorganisation profonde.

Pour reprendre explicitement un historique :

```powershell
pnpm bot observe --from-block 60872394
```

`--once` scanne jusqu'à la tête confirmée puis termine. La commande ne planifie pas automatiquement une exécution future.

## Exécution autonome

Après vérification du wallet, du budget et du précontrôle, pour armer volontairement le bot : mettre `ENABLE_MAINNET_MINT=true` dans `.env`, puis lancer :

```powershell
pnpm bot run
```

**Cette commande activée enverra une vraie transaction mainnet à l'ouverture.** Elle peut être lancée plusieurs heures avant. Garder le PC allumé, connecté, sans mise en veille, et le processus ouvert. Aucun service Windows ni tâche planifiée n'a été installé ; aucun bot n'est actuellement armé.

L'horloge locale sert à réveiller le programme. Le contrat dans l'état pending décide du premier instant valide. Les RPC dont le bloc est trop ancien, dans le futur ou trop en retard sur les autres sont écartés. Entre T−30 et T−8 secondes, le bot prépare la transaction (contrats, éligibilité, nonce, frais, simulation future, gas et budget), avec une validité maximale de 15 secondes depuis le début des lectures. Une préparation lente est interrompue dans le chemin principal à T−2 secondes. À l'ouverture, les RPC sont interrogés en parallèle : la première simulation pending réussie autorise la signature locale et l'envoi de la transaction préparée. Si la préparation manque ou a expiré, le bot refait une préparation complète, plus lente. Garder le wallet inactif pendant cette fenêtre : le nonce et le solde préparés ne sont pas relus après le dernier contrôle.

`pnpm bot run --dry-run` vérifie aussi cette préparation sans accéder à la clé ni signer. Le journal `staging-rehearsal` donne sa durée. Lors de l'exécution, `transaction-prepared` indique que la préparation a réussi, puis `opening-timing` mesure le délai avant diffusion.

Le bot signe localement, sauvegarde durablement la tentative **avant** le premier envoi, et diffuse les mêmes octets sur les RPC sains en parallèle. Le suivi démarre sans attendre les réponses de diffusion de tous les RPC. Chaque fournisseur est sondé indépendamment, avec un tick de 250 ms et une requête en vol au maximum par fournisseur. La latence réelle s'ajoute à ce tick. Les reçus préconfirmés sans hash de bloc canonique sont distingués du succès final ; la détection Flashblocks n'a pas été confirmée sur les endpoints publics configurés. `already known`, `nonce too low` et les timeouts ne prouvent pas un mint réussi. Le succès nécessite un receipt canonique, trois confirmations L2 et un événement de création du NFT vers le wallet attendu. Cela ne signifie pas finalité L1.

Un seul processus peut utiliser ce wallet. Après une interruption, relancer la même commande reprend la transaction sauvegardée, sans changer de nonce. Si le programme a été tué brutalement, un verrou peut rester dans `runtime/<wallet>.lock` : vérifier que le PID contenu dans ce fichier n'exécute plus le bot, puis supprimer uniquement ce verrou. **Ne pas supprimer le fichier `<wallet>-stage-2.json` pour réessayer** : il sert à empêcher les doubles tentatives.

En cas de transaction revertée ou de résultat ambigu après cinq minutes, le bot termine avec une erreur et conserve son état pour revue/reprise. Il n'envoie jamais une nouvelle transaction avec un autre nonce. Les renvois utilisent strictement la même transaction signée. **Le remplacement par augmentation des fees (RBF) n'est pas activé**, faute de validation du comportement des RPC Ronin en condition réelle. Aucun timing de remplacement Ethereum n'est transposé arbitrairement.

Les autres phases allowlist sont sélectionnables avec `STAGE_INDEX=4` ou `5`, mais ne sont pas enchaînées automatiquement. Le bot revérifie leur whitelist et leur stock. Le véritable Public Stage, index 255, est uniquement affiché : son exécution n'est pas implémentée dans cette version centrée sur OG.

## Budget et limites

Avant signature, le contrôle utilise :

```text
gasLimit × maxFeePerGas + 4 × (L1FeeUpperBound + operatorFee) <= MAX_TOTAL_GAS_RON
```

`gasLimit` correspond à l'estimation réussie avec une marge de 30 %. La clé est associée au wallet attendu ; seuls le proxy, le NFT, le stage et les deux sélecteurs vérifiés sont autorisés. Une différence de prix, d'adresse, de calldata, de quantité ou de code bloque l'envoi.

**Le plafond total est un contrôle d'admission local, pas une garantie absolue imposée on-chain.** Une transaction type 2 ne permet pas de plafonner ses frais L1 OP Stack ; ceux-ci peuvent varier après l'estimation. Le composant exécution est plafonné par le protocole. Le prix du NFT reste fixé à zéro par ce bot.

Le test sur fork a consommé 282 605 gas avec un wallet témoin public. C'est une mesure de validation, pas une promesse du coût/temps d'inclusion lors de la course. Ni le multi-RPC ni un gas plus élevé ne garantissent l'obtention d'un NFT.

## Validation et recherche

```powershell
pnpm test
pnpm typecheck
pnpm discover
pnpm test:fork
```

`test:fork` nécessite le fichier local `research/raw/whitelist-samples.json`, produit par la recherche. Il démarre Anvil sur **127.0.0.1:18547**, chain ID **31337**, sans compte de développement généré, copie l'état de Ronin et utilise une adresse publique éligible en impersonation **locale uniquement**. Il avance l'heure locale, exécute un mint, contrôle le NFT reçu et vérifie qu'une deuxième tentative est rejetée. Il termine son processus Anvil. Il ne lit pas `.env` et n'envoie jamais de transaction à l'URL upstream.

Le script postinstall Unix du paquet Anvil est désactivé sous Windows ; son binaire optionnel précompilé est utilisé. Les versions sont verrouillées dans `pnpm-lock.yaml`.

- [Recherche et sources](research/DISCOVERY.md)
- [Rapport du fork local](research/fork-validation.json)
- [Résumé des validations](research/VALIDATION.md)

Erreurs usuelles : `EXPECTED_WALLET_REQUIRED`, `MAX_TOTAL_GAS_RON_REQUIRED`, `WALLET_NOT_ELIGIBLE`, `WALLET_HAS_PENDING_TRANSACTION`, `INSUFFICIENT_RON`, `TOTAL_GAS_CAP_EXCEEDED`, `CONTRACT_CODE_CHANGED`, `STAGE_TIMING_CHANGED`, `MAINNET_DISABLED_SET_ENABLE_MAINNET_MINT`. Les erreurs détaillées des bibliothèques sont volontairement masquées pour éviter d'afficher une clé RPC ou une transaction signée.
