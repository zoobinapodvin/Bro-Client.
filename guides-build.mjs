import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const guides=[
  {
    "slug": "avant-de-commencer",
    "category": "Préparation",
    "title": "Avant de commencer",
    "description": "Vérifiez la compatibilité de Windows, installez les composants nécessaires et préparez votre environnement.",
    "intro": "Une bonne préparation est essentielle pour garantir le bon fonctionnement de votre produit. La plupart des problèmes d’installation proviennent de composants manquants, d’une version obsolète du Launcher ou d’un environnement Windows incompatible.",
    "steps": [
      [
        "Vérification de la compatibilité",
        "<h3>Version de Windows</h3><p>Assurez-vous que votre version de Windows est compatible avec le produit acheté.</p><ul><li>Appuyez simultanément sur <kbd>Windows</kbd> + <kbd>R</kbd>.</li><li>Saisissez <code>winver</code>, puis appuyez sur Entrée.</li><li>Vérifiez votre version de Windows ainsi que son numéro de build.</li><li>Comparez ces informations avec les prérequis de votre produit.</li></ul><h3>Compatibilité des autres systèmes anti-triche</h3><p>Si FACEIT Anti-Cheat ou Riot Vanguard est installé sur votre ordinateur, contactez notre support afin de vérifier leur compatibilité avec votre produit.</p><p>Pensez également à consulter la <a href=\"https://stratx.ac/status\" target=\"_blank\" rel=\"noopener noreferrer\">page de statut des services</a> afin de vérifier qu’aucune maintenance n’est actuellement en cours.</p>"
      ],
      [
        "Installation des composants requis",
        "<p>Pour garantir le bon fonctionnement du Launcher, assurez-vous que les composants suivants sont correctement installés sur votre ordinateur.</p><div class=\"bro-guide-downloads\"><div><h3>Microsoft Visual C++ Redistributable (x64)</h3><p>Composant nécessaire au fonctionnement de nombreuses applications Windows.</p><a href=\"https://aka.ms/vc14/vc_redist.x64.exe\" target=\"_blank\" rel=\"noopener noreferrer\">Télécharger Microsoft Visual C++ <span aria-hidden=\"true\">↗</span></a></div><div><h3>Microsoft DirectX Runtime</h3><p>Ensemble de composants nécessaires au fonctionnement de certaines applications graphiques.</p><a href=\"https://www.microsoft.com/en-us/download/details.aspx?id=35\" target=\"_blank\" rel=\"noopener noreferrer\">Télécharger Microsoft DirectX <span aria-hidden=\"true\">↗</span></a></div><div><h3>WinRAR</h3><p>Logiciel permettant d’extraire les fichiers compressés au format ZIP ou RAR.</p><a href=\"https://www.win-rar.com/download.html\" target=\"_blank\" rel=\"noopener noreferrer\">Télécharger WinRAR <span aria-hidden=\"true\">↗</span></a></div></div><p>Utilisez uniquement les liens de téléchargement officiels et redémarrez votre ordinateur si nécessaire.</p>"
      ],
      [
        "Préparation avant le lancement",
        "<p>Avant d’ouvrir le Launcher, veuillez respecter les recommandations suivantes :</p><ul><li>Fermez complètement votre jeu.</li><li>Fermez les applications et overlays inutiles.</li><li>Vérifiez que la date et l’heure de Windows sont correctement synchronisées.</li><li>Assurez-vous d’utiliser la dernière version du Launcher disponible dans votre espace client.</li><li>Extrayez intégralement les fichiers téléchargés avant de lancer le logiciel.</li></ul><div class=\"bro-guide-note\"><strong>Protection de votre ordinateur</strong><p>Si Windows ou votre antivirus bloque un fichier, consultez l’historique de protection afin d’identifier la raison du blocage et contactez notre support avant toute manipulation.</p><p>Ne modifiez pas les paramètres de sécurité du BIOS ou de Windows sans avoir vérifié les risques associés.</p></div>"
      ],
      [
        "Vous êtes prêt à commencer",
        "<p>Une fois l’ensemble des prérequis vérifiés et les composants installés, vous pouvez passer au guide d’installation et d’activation de votre licence.</p><p>En cas de difficulté, notre support technique reste à votre disposition pour vous accompagner.</p>"
      ]
    ]
  },
  {
    "slug": "installation",
    "category": "Installation & activation",
    "title": "Guide d’installation et de configuration",
    "description": "Découvrez les étapes d’installation du Launcher, de connexion et d’activation de votre licence.",
    "intro": "Ce guide vous accompagne étape par étape dans l’installation, l’activation et la première utilisation de votre produit. Veuillez suivre attentivement chaque instruction afin de garantir une configuration optimale et d’éviter les erreurs de lancement.",
    "steps": [
      [
        "Préparation de votre environnement Windows",
        "<p>Avant de commencer l’installation, assurez-vous que votre ordinateur dispose des prérequis nécessaires au bon fonctionnement du logiciel.</p><ul><li>Vérifiez la compatibilité de votre système avec le produit acheté.</li><li>Installez Microsoft Visual C++ Redistributable (x64).</li><li>Installez les composants Microsoft DirectX nécessaires.</li><li>Fermez votre jeu ainsi que les applications et overlays inutiles.</li></ul><p>Redémarrez votre ordinateur si l’installation des composants le nécessite.</p><p><a href=\"/guides/avant-de-commencer\">Consulter le guide des prérequis →</a></p>"
      ],
      [
        "Téléchargement du Launcher",
        "<p>Récupérez la dernière version du Launcher depuis votre espace client StratX.</p><ul><li>Téléchargez le fichier mis à votre disposition.</li><li>Si le fichier est au format ZIP ou RAR, extrayez intégralement son contenu dans un dossier dédié.</li><li>Conservez l’ensemble des fichiers fournis dans ce même dossier.</li><li>Ne lancez pas directement le logiciel depuis l’archive compressée.</li></ul>"
      ],
      [
        "Lancement du logiciel",
        "<p>Effectuez un clic droit sur l’exécutable du Launcher et sélectionnez <strong>Exécuter en tant qu’administrateur</strong>, uniquement si vous avez vérifié la provenance et la fiabilité du logiciel.</p><p>Patientez jusqu’à la fin de son initialisation et à l’apparition de l’interface de connexion.</p>"
      ],
      [
        "Création de votre compte ou connexion",
        "<p>Lors de votre première utilisation, vous devez créer un compte directement depuis le Launcher.</p><h3>Nouvel utilisateur</h3><ul><li>Cliquez sur « Create Account » ou « Register ».</li><li>Renseignez vos informations de connexion.</li><li>Conservez précieusement vos identifiants.</li></ul><h3>Utilisateur existant</h3><ul><li>Connectez-vous à votre compte habituel.</li><li>Utilisez ce même compte pour activer vos prochaines licences.</li></ul><p>Il n’est pas nécessaire de créer un nouveau compte à chaque achat.</p>"
      ],
      [
        "Activation de votre licence",
        "<p>Une fois connecté à votre compte :</p><ul><li>Accédez à la rubrique « Redeem Key ».</li><li>Copiez votre clé de licence disponible dans votre espace client.</li><li>Collez votre clé dans le champ prévu à cet effet.</li><li>Vérifiez que celle-ci contient exactement 32 caractères, sans espace ni tiret.</li><li>Confirmez son activation.</li></ul><div class=\"bro-guide-note\"><strong>Confidentialité de votre licence</strong><p>Une fois activée, votre licence est associée à votre compte Launcher. Ne communiquez jamais votre clé ou vos identifiants à une autre personne.</p></div>"
      ],
      [
        "Sélection de votre produit",
        "<p>Accédez à la rubrique « Library » pour retrouver les produits associés à votre compte.</p><ul><li>Sélectionnez le jeu concerné.</li><li>Sélectionnez votre produit.</li><li>Démarrez la procédure de lancement.</li><li>Suivez les instructions affichées dans le Launcher.</li></ul>"
      ],
      [
        "Initialisation du produit",
        "<p>Suivez les instructions spécifiques au produit sélectionné.</p><p>Les modalités de lancement, les touches de raccourci et les délais d’initialisation peuvent varier selon le produit. Assurez-vous que son utilisation est autorisée par le jeu concerné.</p><p>En cas de message d’erreur, interrompez la procédure et contactez le support technique en communiquant le message exact rencontré.</p>"
      ],
      [
        "Vérification du bon fonctionnement",
        "<p>Une fois l’initialisation terminée, vérifiez que l’interface du produit est accessible et fonctionne correctement.</p><p>Une barre de progression atteignant 100 % ou la fermeture automatique du Launcher ne signifie pas nécessairement que l’initialisation a réussi.</p>"
      ]
    ]
  },
  {
    "slug": "assistance",
    "category": "Support",
    "title": "Préparer une demande d’assistance",
    "description": "Les informations à transmettre pour obtenir une réponse plus rapide.",
    "intro": "En cas de difficulté, transmettez les informations utiles au support technique dans un ticket privé.",
    "steps": [
      [
        "Identifier le produit",
        "<p>Indiquez le produit et la durée du pass concernés.</p>"
      ],
      [
        "Décrire le problème",
        "<p>Précisez votre version de Windows, l’action effectuée et le message d’erreur exact.</p>"
      ],
      [
        "Joindre une capture",
        "<p>Masquez votre clé et vos identifiants avant de joindre la capture au ticket.</p>"
      ],
      [
        "Ouvrir un ticket",
        "<p>Transmettez ces éléments au support technique dans un ticket privé.</p>"
      ]
    ]
  }
];
const icon=(name)=>name==='book'?'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14M3 5c4-1 7 0 9 2 2-2 5-3 9-2v14c-4-1-7 0-9 2-2-2-5-3-9-2z"/></svg>':'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
const path=g=>'/guides/'+g.slug;
const number=n=>String(n).padStart(2,'0');
const back=(href,label)=>'<a class="bro-guide-back" href="'+href+'"><span aria-hidden="true">←</span> '+label+'</a>';
const support='<aside class="bro-guide-support"><div><span class="bro-guide-kicker">ASSISTANCE TECHNIQUE</span><h2>Besoin d’assistance ?</h2><p>Si vous rencontrez une difficulté pendant l’installation, l’activation ou le lancement de votre produit, ouvrez un ticket auprès du support technique.</p><ul><li>Nom du produit concerné</li><li>Version de Windows</li><li>Description précise du problème rencontré</li><li>Capture d’écran du message d’erreur (sans identifiants ni clé)</li></ul><p>Notre équipe pourra ainsi identifier votre problème et vous accompagner dans sa résolution.</p></div><a class="btn ghost" href="https://discord.gg/uRQyKBhhgA" target="_blank" rel="noopener noreferrer">Contacter le support ↗</a></aside>';
function layout(home,title,description,url,content){
 return home.replace('<body>','<body class="guides-page bro-guides-page">')
 .replace(/<main\b[\s\S]*?<\/main>/,()=>'<main id="main" class="shell"><div class="bro-guides-wrap">'+content+'</div></main>')
 .replace(/<title>[^<]*<\/title>/,'<title>'+title+' · Bro Client</title>')
 .replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="'+description+'"><link rel="canonical" href="https://www.broclient.com'+url+'"><link rel="stylesheet" href="/guides.css?v=20261124">')
 .replaceAll('href="#accueil"','href="/#accueil"').replaceAll('href="#fonctionnalites"','href="/#fonctionnalites"').replaceAll('href="#faq"','href="/#faq"').replace(' aria-current="page"','')
 .replace('<a href="/guides">Guides','<a href="/guides" aria-current="page">Guides')
 .replace('<button data-account><i data-icon="user"></i>Mon espace</button>','<a href="/guides" aria-current="page"><i data-icon="file"></i>Guides</a><button data-account><i data-icon="user"></i>Mon espace</button>');
}
function row(g,i){return '<a class="bro-guide-row" href="'+path(g)+'"><span class="bro-guide-row-icon">'+icon('book')+'</span><div class="bro-guide-row-copy"><span class="bro-guide-kicker">'+number(i+1)+' / '+g.category+'</span><h3>'+g.title+'</h3><p>'+g.description+'</p></div><span class="bro-guide-row-end"><span>'+g.steps.length+' étapes</span>'+icon('arrow')+'</span></a>'}
export async function buildGuides(home){
 const index=back('/','Retour à l’accueil')+'<div class="bro-guide-hero"><span class="bro-guide-kicker">BRO CLIENT / CENTRE D’AIDE</span><h1>Guides et ressources<span>.</span></h1><p>Retrouvez toutes les étapes pour préparer votre ordinateur, installer votre produit et activer votre licence.</p></div><section aria-labelledby="bro-guide-start"><div class="bro-guide-list-head"><h2 id="bro-guide-start">Premiers pas</h2><span>2 guides</span></div><div class="bro-guide-list">'+guides.slice(0,2).map(row).join('')+'</div></section><aside class="bro-guide-help"><div><span class="bro-guide-kicker">SUPPORT</span><h2>Une question ou un problème ?</h2><p>Découvrez les informations à fournir pour obtenir de l’aide rapidement.</p></div><a class="btn ghost" href="/guides/assistance">Guide d’assistance '+icon('arrow')+'</a></aside>';
 const indexHtml=layout(home,'Guides et ressources','Les guides de préparation, installation et assistance Bro Client.','/guides',index);
 assert(indexHtml.includes('href="/guides/installation"')&&indexHtml.includes('href="/">'));
 await writeFile('dist/guides.html',indexHtml);
 for(const [i,g] of guides.entries()){
  const toc=g.steps.map(([title],j)=>'<a href="#etape-'+(j+1)+'"><span>'+number(j+1)+'</span> '+title+'</a>').join('');
  const steps=g.steps.map(([title,body],j)=>'<section class="bro-guide-step" id="etape-'+(j+1)+'"><div class="bro-guide-step-heading"><span>'+number(j+1)+'</span><h2>'+title+'</h2></div>'+body+'</section>').join('');
  const next=i===0?'<a class="bro-guide-next" href="/guides/installation"><div><span class="bro-guide-kicker">ÉTAPE SUIVANTE</span><strong>Guide d’installation et de configuration</strong></div>'+icon('arrow')+'</a>':i===1?'<a class="bro-guide-next" href="/guides/avant-de-commencer"><div><span class="bro-guide-kicker">GUIDE PRÉCÉDENT</span><strong>Avant de commencer</strong></div>'+icon('arrow')+'</a>':'';
  const content=back('/guides','Tous les guides')+'<div class="bro-guide-hero"><span class="bro-guide-kicker">'+g.category+' / '+g.steps.length+' étapes</span><h1>'+g.title+'<span>.</span></h1><p>'+g.intro+'</p></div><div class="bro-guide-layout"><aside class="bro-guide-toc"><h2>Dans ce guide</h2><div role="navigation" aria-label="Sommaire">'+toc+'</div></aside><article class="bro-guide-article">'+steps+next+support+'</article></div>';
  const html=layout(home,g.title,g.description,path(g),content);
  assert(html.includes('id="etape-'+g.steps.length+'"')&&html.includes('href="/guides"'));
  await mkdir('dist/guides',{recursive:true});await writeFile('dist/guides/'+g.slug+'.html',html);
 }
}
