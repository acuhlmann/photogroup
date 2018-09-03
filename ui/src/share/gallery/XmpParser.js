import {get} from 'lodash';

export default class XmpParser {

    static parse(allMetadata, xmpdata) {

        const descriptionPrefix = get(xmpdata, '["x:xmpmeta"]["rdf:RDF"]["rdf:Description"]');

        const title = get(descriptionPrefix, '["dc:title"]["rdf:Alt"]["rdf:li"]["#text"]');
        if(title) {
            allMetadata['Title XMP'] = title;
        }
        const description = get(descriptionPrefix, '["dc:description"]["rdf:Alt"]["rdf:li"]["#text"]');
        if(description) {
            allMetadata['Description XMP'] = description;
        }

        const keywords = get(descriptionPrefix, '["dc:subject"]["rdf:Bag"]["rdf:li"]');
        if(keywords) {
            if(Array.isArray(keywords)) {
                allMetadata['Keywords XMP'] = keywords.map(item => item["#text"]).join(', ');
            } else {
                allMetadata['Keywords XMP'] = keywords["#text"];
            }
        }

        const rating = get(descriptionPrefix, '["@attributes"]["xmp:Rating"]');
        if(rating) {
            allMetadata['Rating XMP'] = rating;
        }

        const historySoftware = get(descriptionPrefix, '["xmpMM:History"]["rdf:Seq"]["rdf:li"]["@attributes"]["stEvt:softwareAgent"]');
        if(historySoftware) {
            allMetadata['x-Last Save with'] = historySoftware;
        }
        const historyLastSave = get(descriptionPrefix, '["xmpMM:History"]["rdf:Seq"]["rdf:li"]["@attributes"]["stEvt:when"]');
        if(historyLastSave) {
            allMetadata['x-Last Save at'] = historyLastSave;
        }
    }
}