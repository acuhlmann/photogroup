import {get} from 'lodash';
import Logger from 'js-logger';
import {XMLParser} from 'fast-xml-parser';

export default class XmpParser {

    static parse(allMetadata, xmp) {

        if(!xmp) return allMetadata;

        const opts = {ignoreAttributes: false}
        const xmlParser = new XMLParser(opts);
        let xmpdata;
        try{
            xmpdata = xmlParser.parse(xmp);
        }catch(error){
            Logger.error(error.message);
            return allMetadata;
        }

        //const title = xmpdata["x:xmpmeta"]["rdf:RDF"]["rdf:Description"]["dc:title"]["rdf:Alt"]["rdf:li"];

        const descriptionPrefix = get(xmpdata, '["x:xmpmeta"]["rdf:RDF"]["rdf:Description"]');

        const title = get(descriptionPrefix, '["dc:title"]["rdf:Alt"]["rdf:li"]["#text"]');
        if(title) {
            allMetadata['Title XMP'] = title;
        }
        const description = get(descriptionPrefix, '["dc:description"]["rdf:Alt"]["rdf:li"]["#text"]');
        if(description) {
            allMetadata['Description XMP'] = description;
        }

        const keywords = get(descriptionPrefix, '["dc:subject"]["rdf:Bag"]["rdf:li"]["#text"]');
        if(keywords) {
            if(Array.isArray(keywords)) {
                allMetadata['Keywords XMP'] = keywords.map(item => item["#text"]).join(', ');
            } else {
                allMetadata['Keywords XMP'] = keywords["#text"];
            }
        }

        const rating = get(descriptionPrefix, '["@_xmp:Rating"]');
        if(rating) {
            allMetadata['Rating XMP'] = rating;
        }

        const historySoftware = get(descriptionPrefix, '["xmpMM:History"]["rdf:Seq"]["rdf:li"]["@_stEvt:softwareAgent"]');
        if(historySoftware) {
            allMetadata['x-Last Save with'] = historySoftware;
        }
        const historyLastSave = get(descriptionPrefix, '["xmpMM:History"]["rdf:Seq"]["rdf:li"]["@_stEvt:when"]');
        if(historyLastSave) {
            allMetadata['x-Last Save at'] = historyLastSave;
        }
        if(descriptionPrefix['@_xmp:CreatorTool']) {
            allMetadata['x-CreatorTool'] = descriptionPrefix['@_xmp:CreatorTool'];
        }
        return allMetadata;
    }
}