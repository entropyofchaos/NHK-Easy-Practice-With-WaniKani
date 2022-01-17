// ==UserScript==
// @name          NHK Easy Practice With WaniKani
// @namespace     https://github.com/entropyofchaos/NHK-Easy-Practice-With-WaniKani
// @version       0.3
// @description   Dynamically hides furigana on NHK Easy website based on a user's Kanji and Vocabulary that are at at least Guru 1.
//                Also works with hiragana.jp which attempts to add furigana to any Japanese website.
// @author        Brian Lichtman
// @include       https://www3.nhk.or.jp/news/easy*
// @include       https://trans.hiragana.jp/*
// @grant         GM.getValue
// @grant         GM.setValue
// @license       GPL version 3 or later: http://www.gnu.org/copyleft/gpl.html
// ==/UserScript==

var apiToken;

// Wait until page finishes loading before trying to overwrite content on the
// NHK Easy website
window.addEventListener("load", function () {
  handleUpdatingPage();
});

/**
 * Function to handle updating the website asynchronously since we need to make calls
 * to the WK API. This is where we will get the user's assignments and then hide the
 * furigana.
 */
async function handleUpdatingPage() {
  apiToken = await getApiToken();

  if (!apiToken) {
    alert(
      "The WaniKani API Token appears to be invalid. The user script \"NHK Easy Practice With WaniKani\" will not be loaded."
    );
  } else {
    // Get the known vocab and kanji for the user
    const knownVocab = new Set();
    await getAssignments(knownVocab);

    // Update the webpage to hide the furigana for the passed in list of vocab and kanji.
    findRubyInPage(knownVocab);

    // Update NHK Easy's pop-up dictionary if it exists on the page.
    if (typeof g_dic !== "undefined") {
      findRubyInDictionary(knownVocab);
    }
  }
}

/**
 * Finds the Ruby tags in NHK Easy and hides the tags that match words in
 * the passed in set of known vocabulary.
 * @param {Set} knownVocab Set of all vocab that has been learned on WK
 */
function findRubyInPage(knownVocab) {
  const theRubyElements = this.document.querySelectorAll("ruby");

  theRubyElements.forEach((foundWord) => {
    // Find all matching words that we know
    let textWithoutRuby = getTextWithoutRuby(foundWord);
    if (knownVocab.has(textWithoutRuby)) {
      // Get ruby text element to hide it
      let rubyText = foundWord.querySelector("rt");

      rubyText.style.visibility = "hidden";
    }
  });
}

/**
 * Finds the Ruby tags in NHK Easy's pop-up dictionary and replaces them with 
 * just the word if the word is in the known set of vocabulary.
 * @param {Set} knownVocab Set of all vocab that has been learned on WK
 */
function findRubyInDictionary(knownVocab) {
  const rubyElementMatcherExp = /<ruby><rb>([^<]*)<\/rb><rt>[^<]*<\/rt><\/ruby>/g;

  Object.keys(g_dic.reikai.entries).forEach(entryKey => {
    g_dic.reikai.entries[entryKey].map(entryValues => {
      entryValues.def = entryValues.def.replaceAll(
        rubyElementMatcherExp,
        (rubyElement, word) => knownVocab.has(word) ? word : rubyElement
      );

      return entryValues;
    });
  });
}

/**
 * Helper function that will return the text held in a Ruby tag (i.e. just the Kanji)
 * without the furigana. The furigana is held in a  child tag of type rt.
 * @param {Element} rubyElement The HTML Element of type Ruby
 * @returns The plain text of the Ruby element
 */
function getTextWithoutRuby(rubyElement) {
  // Create empty array and use its reduce method to modify NodeList held in
  // rubyElement.
  //
  // The reduce method applies a function against an accumulator. result will be
  // the accumulation of text and childNode will be each element of the input
  // being evaluated. Here we try to ignore everything but the actual text in
  // the element.
  //
  // We also set the initial value to an empty string since we want
  // the returned value to be a string.
  //
  // [].reduce.call(arrayLikeObject, callbackFn, initialValue);
  const rtnText = [].reduce.call(
    rubyElement.childNodes,
    (result, childNode) => {
      return (
        result +
        (childNode.nodeType === Node.TEXT_NODE || childNode.nodeName != "RT"
          ? childNode.textContent
          : "")
      );
    },
    ""
  );

  return rtnText;
}

/**
 * Looks up the assignments (vocab and kanji only) of the WK user that have a SRS level
 * of at least Guru 1. These are returned in the knownVocab Set that is passed into the
 * function.
 * @param {Set} knownVocab Set to be populated by this function. When the function returns
 * it will contain all vocabulary and kanji that has been learned on WK up to Guru 1.
 */
async function getAssignments(knownVocab) {
  // Request all assignments for Guru 1 and higher of type kanji and vocab
  let apiEndpointPath =
    "assignments" +
    "?" +
    "srs_stages=5,6,7,8,9" +
    "&" +
    "subject_types=kanji,vocabulary";
  let apiUrlPath = "https://api.wanikani.com/v2/" + apiEndpointPath;
  var requestHeaders = new Headers({
    Authorization: "Bearer " + apiToken,
  });

  // Iterate all the pages of the returned request. An assignments request is limited to 500
  // items meaning we will probably have multiple pages of requests to retrieve.
  let nextPage = apiUrlPath;
  do {
    const apiEndpoint = new Request(decodeURIComponent(nextPage), {
      method: "GET",
      headers: requestHeaders,
    });

    // Get the assignments
    const response = await fetch(apiEndpoint, {}).catch(function (error) {
      console.log(error);
    });
    const jsonData = await response.json();

    nextPage = jsonData.pages.next_url;

    // Get the subject IDs (IDs for vocab and kanji) out of the response. These will be
    // used to request the actual vocab and kanji words from WK.
    const subjectIds = new Set();
    lookupSubjectIds(jsonData, subjectIds);

    // Take the subject IDs and get vocab words out of them. This function will append
    // the additional vocab words found to the passed in set.
    await lookupVocab(subjectIds, knownVocab);
  } while (nextPage);
}

/**
 * Helper function that takes in WK assignments as JSON and appends their contained
 * subject IDs to the passed in set
 * @param {JSON} assignmentsAsJson Object containing an assignment as JSON
 * @param {Set} subjectIds Set of subject IDs to append to
 */
function lookupSubjectIds(assignmentsAsJson, subjectIds) {
  // Get all the subject IDs
  assignmentsAsJson.data.forEach((val) => {
    subjectIds.add(val.data.subject_id);
  });
}

/**
 * Requests the subjects (vocab and kanji) from WK using subject IDs and appends the
 * // found words to the passed in set of vocab.
 * @param {Set} subjectIds Subject IDs to use to lookup vocab and kanji from WK
 * @param {Set} vocabSet Set to be populated by the function. Found words will
 * appended to this set.
 */
async function lookupVocab(subjectIds, vocabSet) {
  // Request all the vocab words based on the list of input subject ids
  let apiEndpointPath = "subjects?ids=" + Array.from(subjectIds).join();
  let apiUrlPath = "https://api.wanikani.com/v2/" + apiEndpointPath;
  var requestHeaders = new Headers({
    Authorization: "Bearer " + apiToken,
  });

  let nextPage = apiUrlPath;
  do {
    const apiEndpoint = new Request(decodeURIComponent(nextPage), {
      method: "GET",
      headers: requestHeaders,
    });

    // Get the subjects from WK
    const response = await fetch(apiEndpoint, {}).catch(function (error) {
      console.log(error);
    });
    const jsonData = await response.json();

    nextPage = jsonData.pages.next_url;

    // Parse the vocab words out of the JSON and put them into my set of
    // known vocab.
    addVocabFromSubjects(jsonData, vocabSet);
  } while (nextPage);
}

/**
 * Helper function that takes in WK subjects as JSON and appends them to the
 * set of vocabulary passed in.
 * @param {JSON} subjectsAsJson Object containing a subject as JSON
 * @param {Set} vocabSet Set of vocabulary to append to
 */
function addVocabFromSubjects(subjectsAsJson, vocabSet) {
  // Add all the vocab words to my list of known vocab
  subjectsAsJson.data.forEach((subject) => {
    vocabSet.add(subject.data.slug);
  });
}

/**
 * Function that gets the api token from storage if it exists.
 * If it doesn't exist, the user is prompted to enter their api token.
 * The newly entered api token is validated by hitting an arbitrary endpoint and making sure
 * an ok response comes back.
 * If the newly entered api token is valid, it is set in the storage.
 * @returns A valid api token, or undefined if the newly entered api token is invalid
 */
async function getApiToken() {
  const existingToken = await GM.getValue("WK_API_TOKEN");
  if (existingToken) {
    return existingToken;
  }

  const apiTokenFromUser = prompt("Please enter your WaniKani API Token to continue:");

  const apiEndpoint = new Request(decodeURIComponent("https://api.wanikani.com/v2/voice_actors"), {
    method: "GET",
    headers: new Headers({
      Authorization: "Bearer " + apiTokenFromUser,
    })
  });

  const response = await fetch(apiEndpoint, {}).catch(function (error) {
    console.log(error);
  });

  if (response.ok) {
    GM.setValue("WK_API_TOKEN", apiTokenFromUser);
    return apiTokenFromUser;
  }

  return undefined;
}
