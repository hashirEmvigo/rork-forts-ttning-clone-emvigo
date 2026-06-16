# AI Assistant – Intern arbetsanteckning

## Syfte

Detta dokument sparar grundtanken bakom vår framtida AI Assistant i CleanOps.

Målet är inte att direkt bygga en full AI-agent som själv fattar beslut, bokar om tider eller hanterar kunder helt automatiskt. Målet är att börja med en kontrollerad AI-assisterad triagefunktion kopplad till REQUEST.

AI Assistant ska minska administrativ belastning genom att ta emot kundens första kontakt, förstå vad ärendet gäller, samla in rätt information och skapa ett bättre underlag för mänsklig hantering.

## Vald riktning

Vi väljer:

**Alternativ B: AI-assisterad triage**

Det innebär att kunden kan skriva fritt i en chatt. AI-assistenten tolkar vad kunden menar, identifierar ärendetyp och ställer relevanta följdfrågor.

Vi avvaktar med:

**Alternativ C: Full AI-agent**

Full AI-agent kan bli aktuell senare, men inte i första versionen. Den kräver starkare kontroll över schema, avtal, fakturor, kundregler, behörigheter, loggning och automatiska beslut.

## Grundprincip

AI Assistant ska inte ersätta REQUEST.

AI Assistant ska vara ett intelligent lager ovanpå REQUEST.

REQUEST är fortfarande systemets centrala ärendehantering. AI Assistant hjälper bara till med första kontakt, triage, informationsinsamling, sammanfattning och eventuell överlämning.

## Första versionen

Första versionen bör heta ungefär:

**AI Assistant Request Intake v1**

Den ska kunna:

→ ta emot kundens fråga i chattformat
→ förstå om ärendet gäller support, reklamation, bokning, ändring, faktura eller annan fråga
→ ställa följdfrågor
→ samla in strukturerad information
→ svara på enkla frågor om svaret finns i godkänd kunskapsbas
→ avgöra om människa behövs
→ kontrollera om någon administratör är tillgänglig
→ annars skapa ett REQUEST-ärende
→ skicka med sammanfattning, saknad information och föreslagen nästa åtgärd

## AI Assistant får göra i v1

→ prata med kunden
→ tolka ärendetyp
→ samla information
→ sammanfatta konversationen
→ föreslå kategori
→ föreslå prioritet
→ föreslå nästa steg
→ skapa REQUEST-ärende eller ärendeutkast
→ lämna över till människa

## AI Assistant får inte göra i v1

→ boka om tider själv
→ avboka personal
→ lova kompensation
→ ändra fakturor
→ fatta avtalsbeslut
→ kontakta leverantörer automatiskt
→ stänga ärenden själv
→ säga att något är löst om människa inte har bekräftat det

## Exempel på kundflöde

Kunden skriver:

“Städningen blev inte bra idag. Badrummet var inte gjort.”

AI Assistant ska då förstå att detta troligen är en reklamation eller kvalitetsavvikelse.

Den ska samla in:

→ kund
→ adress
→ datum
→ vilket område problemet gäller
→ vad som inte blev gjort
→ om kunden vill bifoga bild
→ hur kunden vill bli kontaktad

När informationen är tillräcklig ska AI Assistant skapa ett strukturerat REQUEST-ärende.

Admin ska inte behöva läsa hela chatten först. Admin ska få en tydlig sammanfattning.

## Exempel på REQUEST-data från AI

När AI Assistant skapar ett ärende bör REQUEST kunna innehålla:

→ source: ai_assistant
→ requestType
→ category
→ customerId
→ companyId
→ address / service location
→ summary
→ collectedFacts
→ missingInformation
→ originalCustomerMessage
→ aiConversationId
→ aiConfidenceScore
→ suggestedPriority
→ suggestedNextAction
→ requiresHumanReview

## Kunskapsbas

AI Assistant ska inte svara fritt från allmän kunskap när det gäller företagets rutiner.

Den ska i första hand använda en godkänd kunskapsbas.

Kunskapsbasen kan innehålla:

→ reklamationspolicy
→ avbokningsregler
→ vad som ingår i olika tjänster
→ öppettider
→ kontaktvägar
→ fakturafrågor
→ extra bokningar
→ rutiner vid skada
→ rutiner vid nyckelproblem
→ vanliga kundfrågor

Om AI Assistant inte hittar ett säkert svar ska den inte gissa. Då ska den skapa ett ärende eller lämna över till människa.

## OpenAI / AI-leverantör

Tekniskt kan AI Assistant byggas genom att CleanOps backend kopplas till exempelvis OpenAI API.

Kunden ska inte prata direkt med OpenAI.

Flödet bör vara:

Kund skriver i CleanOps
→ frontend skickar meddelande till backend
→ backend skickar text och instruktioner till AI-leverantör
→ AI returnerar svar eller strukturerad JSON
→ backend sparar konversationen
→ CleanOps visar svar eller skapar REQUEST-ärende

OpenAI/API-nycklar ska aldrig ligga i frontend.

## Viktig säkerhetsregel

AI Assistant ska vara kontrollerad.

Den ska hellre lämna över för ofta än fatta fel beslut.

Om den är osäker ska den:

→ be om mer information
→ skapa ärende
→ lämna över till människa
→ markera låg confidence

## Rekommenderad dokumentstruktur

AI bör ha en egen arkitekturkategori eftersom funktionen senare kan beröra flera delar av systemet.

Rekommenderad mapp:

docs/architecture/ai/

Rekommenderade filer på sikt:

→ 00-ai-assistant-notes.md
→ 01-ai-assistant-request-intake.md
→ 02-ai-knowledge-base.md
→ 03-ai-human-handover.md
→ 04-ai-admin-copilot.md
→ 05-ai-agent-actions-future.md

## Viktig slutsats

Vi ska inte börja med en full AI-agent.

Vi ska börja med en AI-assisterad intake- och triagefunktion.

Det första målet är att skapa bättre ärenden, minska administration och ge kunden en smidigare första kontakt.

AI Assistant ska hjälpa systemet att förstå, strukturera och prioritera — inte fatta stora affärsbeslut själv.
