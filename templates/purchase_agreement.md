**KOOPOVEREENKOMST – Roerende Zaken**
**Partijen:**
1. **Koper**: {{koper.naam}}{{#koper.adres}}, {{koper.adres}}{{/koper.adres}}; en
2. **Verkoper**: {{verkoper.naam}}{{#verkoper.adres}}, {{verkoper.adres}}{{/verkoper.adres}}.

**Overeenkomst:**
**1. Omschrijving van het object**
Het verkochte betreft: **{{object.omschrijving}}**{{#object.conditie}}, conditie: {{object.conditie}}{{/object.conditie}}{{#object.identifiers}} (identificatie: {{object.identifiers}}){{/object.identifiers}}.

**2. Prijs en betaling**
De koopprijs bedraagt **{{#prijs.bedrag}}€ {{prijs.bedrag}}{{else}}€ …{{/prijs.bedrag}}**.
Betaling via {{#betaling.wijze}}{{betaling.wijze}}{{else}}overboeking{{/betaling.wijze}} op {{#betaling.moment}}{{betaling.moment}}{{else}}moment van levering{{/betaling.moment}}.

**3. Levering en risico**
Levering vindt plaats op **{{levering.datum}}** te **{{levering.plaats}}**.
Het risico gaat over bij levering.

**4. Eigendom en garanties**
Verkoper verklaart eigenaar te zijn en dat het object vrij is van beslagen en beperkte rechten.
Verborgen gebreken die verkoper kende blijven voor rekening van verkoper.

**5. Toepasselijk recht en forumkeuze**
Op deze overeenkomst is **Nederlands recht** van toepassing.
Geschillen worden exclusief voorgelegd aan de **{{#forum.rechtbank}}{{forum.rechtbank}}{{else}}dichtstbijzijnde rechtbank bij woonplaats koper{{/forum.rechtbank}}**.

**Deze overeenkomst is ondertekend door:**

**Koper**: {{#koper.naam}}{{koper.naam}}{{else}}Koper{{/koper.naam}}
Handtekening: _________________________________
Datum: __________________
**Verkoper**: {{#verkoper.naam}}{{verkoper.naam}}{{else}}Verkoper{{/verkoper.naam}}
Handtekening: _________________________________
Datum: __________________
