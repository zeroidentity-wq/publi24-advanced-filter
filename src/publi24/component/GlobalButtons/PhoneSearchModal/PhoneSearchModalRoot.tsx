import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import AdsModal from '../../Common/Partials/AdsModal/AdsModal';
import { WWStorage, AdUuid } from '../../../core/storage';
import {AdData, adData} from '../../../core/adData';
import {PhoneIcon} from "../../Common/Icons/PhoneIcon";
import {misc} from "../../../core/misc";
import {inspectorEscorteApi, InspectorAd} from '../../../core/inspectorEscorteApi';
import AdsList from '../../Common/Partials/AdList/AdsList';
import {renderer} from '../../../core/renderer';
import {IS_MOBILE_VIEW} from '../../../../common/globals';
import {adActions} from '../../../core/adActions';
import {WWBrowserStorage} from '../../../core/browserStorage';
import {SearchResult, linksFilter} from '../../../core/linksFilter';
import {utils} from '../../../../common/utils';
import styles from '../../Common/Partials/AdsModal/AdsModal.module.scss';

const PAGE_SIZE = 15;

type PhoneSearchRootProps = {
  onClose: () => void;
};

const DEBOUNCE_DELAY = 1500;

function normalizePhoneNumber(value: string): string {
  return value.replace(/^\+?40/, '0').replace(/\s+/g, '').trim();
}

const registerAds = (context: HTMLElement, showDuplicates: boolean) => {
  renderer.registerAdsInContext(context, {updateSeenTime: true, renderOptions: {showDuplicates}});
};

const PhoneSearchModalRoot: React.FC<PhoneSearchRootProps> = ({ onClose }) => {
  const [listState, setListState] = useState<{ads: AdData[], breaks: number[], errors: string[]} | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [searchedPhone, setSearchedPhone] = useState<string | null>(null);
  const [source, setSource] = useState<'inspector-escorte' | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [fullSearchSessionId, setFullSearchSessionId] = useState<string | null>(null);
  const [fullSearchResults, setFullSearchResults] = useState<SearchResult[] | null>(null);
  const [fullSearchLoading, setFullSearchLoading] = useState(false);
  const [fullSearchError, setFullSearchError] = useState<string | null>(null);
  const pendingUuidsRef = useRef<AdUuid[]>([]);
  const pendingInspectorAdsRef = useRef<InspectorAd[]>([]);
  const totalCountRef = useRef<number>(0);
  const savedScrollRef = useRef<{el: HTMLElement, top: number} | null>(null);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNextPage = useCallback(async () => {
    const el = document.querySelector('[data-wwid="ads-modal"]') as HTMLElement | null;
    if (el) {
      savedScrollRef.current = {el, top: el.scrollTop};
    }

    setIsLoadingMore(true);
    try {
      let result: {ads: AdData[], errors: string[]};

      if (pendingInspectorAdsRef.current.length > 0) {
        const batch = pendingInspectorAdsRef.current.splice(0, PAGE_SIZE);
        result = await adData.loadInInspectorAdsData(batch, searchedPhone!);
      } else {
        const batch = pendingUuidsRef.current.splice(0, PAGE_SIZE);
        if (batch.length === 0) {
          return;
        }
        result = await adData.loadInAdsData(batch);
      }

      setListState((prev) => {
        const prevAds = prev?.ads ?? [];
        return {
          ads: [...prevAds, ...result.ads],
          breaks: [...(prev?.breaks ?? []), prevAds.length],
          errors: [...(prev?.errors ?? []), ...result.errors],
        };
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [searchedPhone]);

  const performLocalSearch = useCallback(async (phoneToSearch: string) => {
    setIsLoading(true);
    try {
      const uuids = WWStorage.getPhoneAds(phoneToSearch) || [];
      totalCountRef.current = uuids.length;
      pendingUuidsRef.current = uuids.slice(PAGE_SIZE);
      const firstBatch = uuids.slice(0, PAGE_SIZE);

      if (firstBatch.length > 0) {
        const {ads: items, errors} = await adData.loadInAdsData(
          firstBatch,
          (uuid: string) => WWStorage.removePhoneAd(phoneToSearch, uuid)
        );
        setListState({ads: items, breaks: [], errors});
      } else {
        setListState({ads: [], breaks: [], errors: []});
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const performSearch = useCallback(async (phoneToSearch: string) => {
    setSearchedPhone(phoneToSearch);
    setIsLoading(true);

    try {
      const enabled = await inspectorEscorteApi.isEnabledAndAvailable();

      if (enabled) {
        const allInspectorAds = await adData.fetchInspectorEscorteAds(phoneToSearch);
        setSource('inspector-escorte');

        totalCountRef.current = allInspectorAds.length;
        pendingInspectorAdsRef.current = allInspectorAds.slice(PAGE_SIZE);
        const firstBatch = allInspectorAds.slice(0, PAGE_SIZE);
        const {ads: items, errors} = await adData.loadInInspectorAdsData(firstBatch, phoneToSearch);
        setListState({ads: items, breaks: [], errors});

        return;
      }

      setSource(undefined);
      await performLocalSearch(phoneToSearch);
    } catch (error) {
      console.error('Failed to search phone ads.', error);
      setSource(undefined);
      setListState({ads: [], breaks: [], errors: []});
    } finally {
      setIsLoading(false);
    }
  }, [performLocalSearch]);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    const cleanedPhone = normalizePhoneNumber(rawValue);

    setPhoneInput(rawValue);
    setListState(null);
    setSearchedPhone(null);
    setSource(undefined);
    pendingUuidsRef.current = [];
    pendingInspectorAdsRef.current = [];
    totalCountRef.current = 0;
    setFullSearchSessionId(null);
    setFullSearchResults(null);
    setFullSearchError(null);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (cleanedPhone) {
      debounceTimeoutRef.current = setTimeout(() => {
        performSearch(cleanedPhone);
      }, DEBOUNCE_DELAY);
    }
  }, [performSearch]);

  const handleFullSearch = useCallback(async () => {
    const cleanedPhone = normalizePhoneNumber(phoneInput);

    if (!cleanedPhone) {
      setFullSearchError('Introdu un număr de telefon pentru căutarea completă.');
      return;
    }

    setFullSearchLoading(true);
    setFullSearchSessionId(null);
    setFullSearchResults(null);
    setFullSearchError(null);

    try {
      const searchId = await adActions.startManualPhoneSearch(cleanedPhone);
      setFullSearchSessionId(searchId);
    } catch (error) {
      console.error('Failed to start manual full phone search.', error);
      setFullSearchLoading(false);
      setFullSearchError(`Eroare căutare completă: ${utils.formatError(error)}`);
    }
  }, [phoneInput]);

  useEffect(() => {
    if (!fullSearchSessionId) {
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const resultKey = `ww:search_results:${fullSearchSessionId}`;

    const pollSearchResults = async () => {
      try {
        const data = await WWBrowserStorage.get([resultKey, 'ww:search_started_for']);

        if (cancelled) {
          return;
        }

        const results = data[resultKey];
        const searchState = data['ww:search_started_for'] as {wwid?: string} | undefined;

        if (Array.isArray(results)) {
          setFullSearchResults(results as SearchResult[]);
        }

        if (Array.isArray(results) && searchState?.wwid !== fullSearchSessionId) {
          setFullSearchLoading(false);
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
        }
      } catch (error) {
        console.error('Failed to read manual full phone search results.', error);

        if (!cancelled) {
          setFullSearchLoading(false);
          setFullSearchError(`Eroare citire rezultate: ${utils.formatError(error)}`);
        }

        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      }
    };

    interval = setInterval(() => {
      void pollSearchResults();
    }, 300);
    void pollSearchResults();

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [fullSearchSessionId]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (savedScrollRef.current) {
      const {el, top} = savedScrollRef.current;
      el.scrollTop = top;
      savedScrollRef.current = null;
    }
  }, [listState]);

  const renderAds = useCallback((ads: AdData[], sectionBreaks?: number[]) => (
    <AdsList
      adsData={ads}
      sectionBreaks={sectionBreaks}
      isMobile={IS_MOBILE_VIEW}
      onRegister={registerAds}
    />
  ), []);

  const fullSearchLinks = fullSearchResults
    ? linksFilter.sortLinks(linksFilter.filterLinks(fullSearchResults, ''))
    : [];

  const fullSearchContent = (fullSearchLoading || fullSearchSessionId || fullSearchError) ? (
    <div className={styles.fullSearchContent} data-wwid="full-phone-search-results">
      <h4 className={styles.fullSearchTitle}>Rezultate căutare completă</h4>
      {fullSearchError ? (
        <p className={styles.fullSearchError} data-wwid="full-phone-search-error">{fullSearchError}</p>
      ) : fullSearchLoading ? (
        <p className={styles.fullSearchStatus} data-wwid="full-phone-search-status">Se caută pe Google...</p>
      ) : fullSearchLinks.length === 0 ? (
        <p className={styles.fullSearchStatus} data-wwid="full-phone-search-status">Nu au fost găsite linkuri relevante.</p>
      ) : (
        <div className={styles.fullSearchLinks}>
          {fullSearchLinks.map((link, index) => {
            const isGoto = Array.isArray(link);
            const href = isGoto
              ? new URL(link[1], 'https://www.google.com').href
              : link;
            const display = isGoto
              ? link[0]
              : link.replace(/^https?:\/\/(www\.)?|^www\./, '');

            return (
              <a
                key={`${display}-${index}`}
                className={styles.fullSearchLink}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {display}
              </a>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  return (
    <AdsModal
      {...({ source, sourcePhone: source === 'inspector-escorte' ? searchedPhone : undefined } as any)}
      close={onClose}
      adsData={listState?.ads ?? null}
      errors={listState?.errors}
      title={<><PhoneIcon fill={misc.getPubliTheme() === 'dark' ? '#bfbfbf' : '#fff'}/> Anunțuri</>}
      onInputChange={handleInputChange}
      inputValue={phoneInput}
      inputDisabled={fullSearchLoading}
      onFullSearch={handleFullSearch}
      fullSearchDisabled={!normalizePhoneNumber(phoneInput)}
      fullSearchLoading={fullSearchLoading}
      fullSearchContent={fullSearchContent}
      totalCount={totalCountRef.current || undefined}
      hasMore={pendingUuidsRef.current.length > 0 || pendingInspectorAdsRef.current.length > 0}
      isLoadingMore={isLoadingMore}
      isLoading={isLoading}
      onLoadMore={loadNextPage}
      sectionBreaks={listState?.breaks}
      renderAds={renderAds}
    />
  );
};

export default PhoneSearchModalRoot;
