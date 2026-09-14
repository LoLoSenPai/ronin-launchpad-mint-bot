# Validation RPC — 12 septembre 2026

Configuration : RPC officiel `https://api.roninchain.com/rpc` et RPC public thirdweb `https://2020.rpc.thirdweb.com`.
Source fournisseur : https://thirdweb.com/ronin (chain ID 2020 et URL RPC).

Contrôles en lecture seule avec le transport réel du bot (batch maximal de trois appels) :

- Les deux endpoints répondent sur le réseau 2020 avec des blocs récents.
- Même hash pour le bloc de référence demandé aux deux endpoints.
- Contrats, implémentation et éligibilité OG du wallet configuré validés par le précontrôle sur thirdweb.
- Simulation pending : phase pas encore commencée, résultat attendu.
- Simulation hypothétique à l'ouverture via eth_simulateV1 : succès, 282 605 gas.
- Lecture des frais et calcul du budget réussis.
- Mesure ponctuelle santé : officiel 218 ms, thirdweb 351 ms. Ce n'est pas un benchmark ni une garantie à l'ouverture.

Aucune signature ni transaction diffusée pour ces tests. L'envoi réel via thirdweb n'a donc pas été testé. Aucun compte ni clé API requis lors des tests publics. Disponibilité et quotas peuvent varier.

dRPC et LGNS indisponibles lors des sondes, remplacés dans la configuration. Tenderly répondait aux blocs mais échouait au précontrôle avec le transport actuel ; Conduit échouait également aux lectures de contrat. Ils ne sont pas ajoutés.

Cette validation complète VALIDATION.md : la simulation future, auparavant seulement validée sur fork local, fonctionne aussi sur thirdweb au moment de ce contrôle.
